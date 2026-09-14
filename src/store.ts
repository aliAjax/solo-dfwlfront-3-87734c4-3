import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Cargo, ContainerInst, DgClass, Placement, RotationMode } from "./types";
import { CONTAINER_TYPES, dgConflictReason, uid } from "./data";
import {
  autoPack,
  containerStats,
  findPlacementInContainer,
  settleAt,
  validatePlacement,
} from "./packer";
import { exportManifest, exportUtilization } from "./export";

const STORAGE_KEY = "clsv-state-v1";

export interface CargoInput {
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  rotation: RotationMode;
  dgClass: DgClass;
  stackLimit: number;
}

interface PersistState {
  cargos: Cargo[];
  containers: ContainerInst[];
  placements: Placement[];
  allowedTypes: string[];
  unplacedReasons: Record<string, string>;
  notes: string[];
}

export const useLoadStore = defineStore("load", () => {
  const cargos = ref<Cargo[]>([]);
  const containers = ref<ContainerInst[]>([]);
  const placements = ref<Placement[]>([]);
  const allowedTypes = ref<string[]>(["20GP", "40GP", "40HQ"]);
  const unplacedReasons = ref<Record<string, string>>({});
  const notes = ref<string[]>([]);
  const notice = ref<{ type: "ok" | "err"; text: string } | null>(null);
  /** 最近被判定冲突的货物 id（用于高亮） */
  const conflictIds = ref<string[]>([]);

  const cargoMap = computed(() => new Map(cargos.value.map((c) => [c.id, c])));
  const placedIds = computed(() => new Set(placements.value.map((p) => p.cargoId)));
  const unplacedCargos = computed(() => cargos.value.filter((c) => !placedIds.value.has(c.id)));
  const allowedContainerTypes = computed(() =>
    CONTAINER_TYPES.filter((t) => allowedTypes.value.includes(t.id)),
  );

  function typeById(id: string) {
    return CONTAINER_TYPES.find((t) => t.id === id) ?? null;
  }

  function placementsOf(containerId: string): Placement[] {
    return placements.value.filter((p) => p.containerId === containerId);
  }

  function containerNameOf(cargoId: string): string | null {
    const p = placements.value.find((pl) => pl.cargoId === cargoId);
    if (!p) return null;
    return containers.value.find((c) => c.id === p.containerId)?.name ?? null;
  }

  function statsOf(containerId: string) {
    const inst = containers.value.find((c) => c.id === containerId);
    const type = inst ? typeById(inst.typeId) : null;
    if (!type) return null;
    return containerStats(type, placementsOf(containerId), cargoMap.value);
  }

  // ---------- 提示与冲突高亮 ----------

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(type: "ok" | "err", text: string) {
    notice.value = { type, text };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = null), 4200);
  }

  let conflictTimer: ReturnType<typeof setTimeout> | undefined;
  function highlightConflicts(ids: string[]) {
    conflictIds.value = ids;
    if (conflictTimer) clearTimeout(conflictTimer);
    conflictTimer = setTimeout(() => (conflictIds.value = []), 2600);
  }

  // ---------- 货物管理 ----------

  function addCargo(input: CargoInput, quantity: number) {
    const qty = Math.max(1, Math.min(99, Math.floor(quantity) || 1));
    for (let i = 0; i < qty; i++) {
      cargos.value.push({
        ...input,
        id: uid(),
        name: qty > 1 ? `${input.name} #${i + 1}` : input.name,
      });
    }
    flash("ok", `已录入 ${qty} 件「${input.name}」，点击「自动装箱」分配集装箱`);
  }

  function removeCargo(id: string) {
    cargos.value = cargos.value.filter((c) => c.id !== id);
    placements.value = placements.value.filter((p) => p.cargoId !== id);
    delete unplacedReasons.value[id];
  }

  // ---------- 自动装箱 ----------

  function runAutoPack() {
    if (!cargos.value.length) {
      flash("err", "请先录入货物");
      return;
    }
    if (!allowedContainerTypes.value.length) {
      flash("err", "请至少选择一种可用箱型");
      return;
    }
    const res = autoPack(cargos.value, allowedContainerTypes.value);
    containers.value = res.containers;
    placements.value = res.placements;
    unplacedReasons.value = Object.fromEntries(res.unplaced.map((u) => [u.cargoId, u.reason]));
    notes.value = res.notes;
    flash(
      res.unplaced.length ? "err" : "ok",
      `自动装箱完成：${res.containers.length} 箱 / ${res.placements.length} 件已装` +
        (res.unplaced.length ? `，${res.unplaced.length} 件未装箱` : ""),
    );
  }

  // ---------- 手动调整（拖动 / 旋转 / 换箱） ----------

  /** 校验并提交一个候选摆放；失败时高亮冲突货物并提示原因 */
  function commitPlacement(cargoId: string, cand: Placement, okMsg: string): boolean {
    const inst = containers.value.find((c) => c.id === cand.containerId);
    const type = inst ? typeById(inst.typeId) : null;
    if (!inst || !type) return false;
    const others = placements.value.filter(
      (p) => p.containerId === cand.containerId && p.cargoId !== cargoId,
    );
    const v = validatePlacement(type, others, cargoMap.value, cand);
    if (!v.ok) {
      highlightConflicts([cargoId, ...v.conflicts.map((c) => c.cargoId)]);
      flash("err", `已拒绝该移动：${v.reason}`);
      return false;
    }
    const existing = placements.value.find((p) => p.cargoId === cargoId);
    if (existing) Object.assign(existing, cand);
    else placements.value.push(cand);
    delete unplacedReasons.value[cargoId];
    flash("ok", okMsg);
    return true;
  }

  /** 拖动落点（箱内水平坐标），自动重力沉降后校验 */
  function moveCargo(cargoId: string, x: number, y: number) {
    const p = placements.value.find((pl) => pl.cargoId === cargoId);
    const cargo = cargoMap.value.get(cargoId);
    if (!p || !cargo) return;
    const inst = containers.value.find((c) => c.id === p.containerId);
    const type = inst ? typeById(inst.typeId) : null;
    if (!inst || !type) return;
    const others = placements.value.filter(
      (pl) => pl.containerId === p.containerId && pl.cargoId !== cargoId,
    );
    const cand = settleAt(type, others, cargo, p.containerId, x, y, {
      dx: p.dx,
      dy: p.dy,
      dz: p.dz,
    });
    if (!cand) {
      highlightConflicts([cargoId]);
      flash("err", "已拒绝该移动：目标位置超出箱内空间或高度不足");
      return;
    }
    commitPlacement(cargoId, cand, `「${cargo.name}」已调整位置`);
  }

  /** 水平旋转 90°（货物需允许旋转），重新沉降并校验 */
  function rotateCargo(cargoId: string) {
    const p = placements.value.find((pl) => pl.cargoId === cargoId);
    const cargo = cargoMap.value.get(cargoId);
    if (!p || !cargo) return;
    if (cargo.rotation === "none") {
      flash("err", `「${cargo.name}」不可旋转`);
      return;
    }
    const inst = containers.value.find((c) => c.id === p.containerId);
    const type = inst ? typeById(inst.typeId) : null;
    if (!inst || !type) return;
    const others = placements.value.filter(
      (pl) => pl.containerId === p.containerId && pl.cargoId !== cargoId,
    );
    const cand = settleAt(type, others, cargo, p.containerId, p.x, p.y, {
      dx: p.dy,
      dy: p.dx,
      dz: p.dz,
    });
    if (!cand) {
      highlightConflicts([cargoId]);
      flash("err", "已拒绝旋转：旋转后超出箱内空间或高度不足");
      return;
    }
    commitPlacement(cargoId, cand, `「${cargo.name}」已旋转 90°`);
  }

  /** 换箱：校验目标箱危险品隔离、载重与空间，失败给出原因 */
  function transferCargo(cargoId: string, targetContainerId: string) {
    const cargo = cargoMap.value.get(cargoId);
    const target = containers.value.find((c) => c.id === targetContainerId);
    const type = target ? typeById(target.typeId) : null;
    if (!cargo || !target || !type) return;
    const current = placements.value.find((p) => p.cargoId === cargoId);
    if (current && current.containerId === targetContainerId) return;

    const targetPl = placements.value.filter(
      (p) => p.containerId === targetContainerId && p.cargoId !== cargoId,
    );
    // 先给出更具可读性的拒绝原因
    const dgHit = targetPl
      .map((p) => ({ other: cargoMap.value.get(p.cargoId), p }))
      .find(({ other }) => other && dgConflictReason(cargo.dgClass, other.dgClass));
    if (dgHit && dgHit.other) {
      const reason = dgConflictReason(cargo.dgClass, dgHit.other.dgClass) ?? "危险品不相容";
      highlightConflicts([cargoId, dgHit.p.cargoId]);
      flash("err", `已拒绝换箱：${reason}（与「${dgHit.other.name}」冲突）`);
      return;
    }
    const used = targetPl.reduce((s, p) => s + (cargoMap.value.get(p.cargoId)?.weight ?? 0), 0);
    if (used + cargo.weight > type.payload) {
      highlightConflicts([cargoId]);
      flash("err", `已拒绝换箱：${target.name} 载重将超限（${type.payload} kg）`);
      return;
    }
    const found = findPlacementInContainer(type, targetPl, cargoMap.value, cargo, target.id);
    if (!found) {
      highlightConflicts([cargoId]);
      flash("err", `已拒绝换箱：${target.name} 内空间不足`);
      return;
    }
    commitPlacement(cargoId, found, `「${cargo.name}」已换箱至 ${target.name}`);
  }

  // ---------- 导出 / 重置 ----------

  function exportData() {
    return {
      cargos: cargos.value,
      containers: containers.value,
      placements: placements.value,
      types: CONTAINER_TYPES,
      unplacedReasons: unplacedReasons.value,
    };
  }

  function doExportManifest() {
    if (!placements.value.length) {
      flash("err", "暂无装载结果可导出");
      return;
    }
    exportManifest(exportData());
    flash("ok", "已导出装载清单 CSV");
  }

  function doExportUtilization() {
    if (!containers.value.length) {
      flash("err", "暂无集装箱可导出");
      return;
    }
    exportUtilization(exportData());
    flash("ok", "已导出各箱利用率 CSV");
  }

  function clearAll() {
    cargos.value = [];
    containers.value = [];
    placements.value = [];
    unplacedReasons.value = {};
    notes.value = [];
    flash("ok", "已清空全部数据");
  }

  function resetDemo() {
    seed();
    runAutoPack();
  }

  // ---------- 持久化 ----------

  function persist() {
    const state: PersistState = {
      cargos: cargos.value,
      containers: containers.value,
      placements: placements.value,
      allowedTypes: allowedTypes.value,
      unplacedReasons: unplacedReasons.value,
      notes: notes.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时忽略
    }
  }

  function loadState(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw) as Partial<PersistState>;
      cargos.value = Array.isArray(s.cargos) ? s.cargos : [];
      containers.value = Array.isArray(s.containers) ? s.containers : [];
      placements.value = Array.isArray(s.placements) ? s.placements : [];
      allowedTypes.value = Array.isArray(s.allowedTypes) && s.allowedTypes.length
        ? s.allowedTypes
        : ["20GP", "40GP", "40HQ"];
      unplacedReasons.value = s.unplacedReasons ?? {};
      notes.value = Array.isArray(s.notes) ? s.notes : [];
      return true;
    } catch {
      return false;
    }
  }

  function seed() {
    const list: [CargoInput, number][] = [
      [
        { name: "机械设备", length: 120, width: 100, height: 90, weight: 850, rotation: "none", dgClass: "none", stackLimit: 2000 },
        2,
      ],
      [
        { name: "纸箱日用品", length: 60, width: 40, height: 50, weight: 25, rotation: "full", dgClass: "none", stackLimit: 200 },
        8,
      ],
      [
        { name: "易燃涂料(3类)", length: 80, width: 60, height: 60, weight: 120, rotation: "horizontal", dgClass: "3", stackLimit: 0 },
        3,
      ],
      [
        { name: "氧化剂试剂(5.1类)", length: 50, width: 50, height: 50, weight: 90, rotation: "none", dgClass: "5.1", stackLimit: 0 },
        2,
      ],
      [
        { name: "板式家具", length: 200, width: 80, height: 70, weight: 60, rotation: "horizontal", dgClass: "none", stackLimit: 500 },
        2,
      ],
      [
        { name: "瓷砖托盘", length: 100, width: 100, height: 40, weight: 400, rotation: "none", dgClass: "none", stackLimit: 800 },
        2,
      ],
    ];
    cargos.value = [];
    containers.value = [];
    placements.value = [];
    unplacedReasons.value = {};
    notes.value = [];
    for (const [input, qty] of list) {
      for (let i = 0; i < qty; i++) {
        cargos.value.push({
          ...input,
          id: uid(),
          name: qty > 1 ? `${input.name} #${i + 1}` : input.name,
        });
      }
    }
  }

  if (!loadState()) {
    seed();
    const res = autoPack(cargos.value, allowedContainerTypes.value);
    containers.value = res.containers;
    placements.value = res.placements;
    unplacedReasons.value = Object.fromEntries(res.unplaced.map((u) => [u.cargoId, u.reason]));
    notes.value = res.notes;
  }

  watch([cargos, containers, placements, allowedTypes, unplacedReasons, notes], persist, {
    deep: true,
  });

  return {
    cargos,
    containers,
    placements,
    allowedTypes,
    unplacedReasons,
    notes,
    notice,
    conflictIds,
    cargoMap,
    placedIds,
    unplacedCargos,
    allowedContainerTypes,
    typeById,
    placementsOf,
    containerNameOf,
    statsOf,
    addCargo,
    removeCargo,
    runAutoPack,
    moveCargo,
    rotateCargo,
    transferCargo,
    doExportManifest,
    doExportUtilization,
    clearAll,
    resetDemo,
  };
});
