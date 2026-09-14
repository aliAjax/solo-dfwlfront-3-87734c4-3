import type { Cargo, ContainerInst, ContainerType, Placement } from "./types";
import { dgConflictReason, uid } from "./data";

export interface OrientedDims {
  dx: number;
  dy: number;
  dz: number;
}

/** 底部支撑覆盖率下限 */
export const MIN_SUPPORT_RATIO = 0.7;
/** 重心偏移告警阈值（相对半长/半宽的百分比） */
export const COG_WARN_PCT = 10;

/** 按可旋转方式枚举货物可用朝向，优先底面积大、重心低的摆法 */
export function orientations(cargo: Cargo): OrientedDims[] {
  const { length: L, width: W, height: H } = cargo;
  const seen = new Set<string>();
  const out: OrientedDims[] = [];
  const push = (dx: number, dy: number, dz: number) => {
    const key = `${dx}x${dy}x${dz}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ dx, dy, dz });
    }
  };
  if (cargo.rotation === "none") {
    push(L, W, H);
  } else if (cargo.rotation === "horizontal") {
    push(L, W, H);
    push(W, L, H);
  } else {
    push(L, W, H);
    push(L, H, W);
    push(W, L, H);
    push(W, H, L);
    push(H, L, W);
    push(H, W, L);
  }
  return out.sort((a, b) => b.dx * b.dy - a.dx * a.dy || a.dz - b.dz);
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** 两摆放在水平面上的投影重叠面积（cm²），不重叠为 0 */
export function footprintOverlap(a: Placement, b: Placement): number {
  const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function intersect3D(a: Placement, b: Placement): boolean {
  return (
    overlap1D(a.x, a.x + a.dx, b.x, b.x + b.dx) &&
    overlap1D(a.y, a.y + a.dy, b.y, b.y + b.dy) &&
    overlap1D(a.z, a.z + a.dz, b.z, b.z + b.dz)
  );
}

export interface Conflict {
  cargoId: string;
  reason: string;
}

export interface ValidationResult {
  ok: boolean;
  reason: string;
  conflicts: Conflict[];
}

const OK: ValidationResult = { ok: true, reason: "", conflicts: [] };

function fail(reason: string, conflicts: Conflict[] = []): ValidationResult {
  return { ok: false, reason, conflicts };
}

/** 支撑与堆码承重校验（candidate.z > 0 时） */
function checkSupport(
  placements: Placement[],
  cargoMap: Map<string, Cargo>,
  candidate: Placement,
  candCargo: Cargo,
): ValidationResult {
  if (candidate.z === 0) return OK;
  const conflicts: Conflict[] = [];
  let supported = 0;
  const fp = candidate.dx * candidate.dy;

  // 现有每件货物承受的直接堆压重量
  const loadOn = new Map<string, number>();
  for (const q of placements) {
    if (q.z === 0) continue;
    const qw = cargoMap.get(q.cargoId)?.weight ?? 0;
    for (const b of placements) {
      if (b === q || b.z + b.dz !== q.z) continue;
      if (footprintOverlap(b, q) > 0) {
        loadOn.set(b.cargoId, (loadOn.get(b.cargoId) ?? 0) + qw);
      }
    }
  }

  for (const b of placements) {
    if (b.z + b.dz !== candidate.z) continue;
    const ov = footprintOverlap(b, candidate);
    if (ov <= 0) continue;
    const below = cargoMap.get(b.cargoId);
    if (!below) continue;
    if (below.stackLimit <= 0) {
      conflicts.push({ cargoId: b.cargoId, reason: `「${below.name}」不可堆压` });
      continue;
    }
    supported += ov;
    const after = (loadOn.get(b.cargoId) ?? 0) + candCargo.weight;
    if (after > below.stackLimit) {
      conflicts.push({
        cargoId: b.cargoId,
        reason: `超过「${below.name}」堆码承重上限 ${below.stackLimit} kg`,
      });
    }
  }
  if (conflicts.length) return fail(conflicts[0].reason, conflicts);
  if (supported / fp < MIN_SUPPORT_RATIO) {
    return fail(`底部支撑不足（需≥${Math.round(MIN_SUPPORT_RATIO * 100)}%）`);
  }
  return OK;
}

/**
 * 校验一个候选摆放在箱内是否合法：
 * 边界、重叠、支撑、堆码承重、危险品隔离、载重。
 * placements 为同箱其他货物（不含 candidate 自身）。
 */
export function validatePlacement(
  type: ContainerType,
  placements: Placement[],
  cargoMap: Map<string, Cargo>,
  candidate: Placement,
): ValidationResult {
  const candCargo = cargoMap.get(candidate.cargoId);
  if (!candCargo) return fail("货物不存在");

  if (
    candidate.x < 0 ||
    candidate.y < 0 ||
    candidate.z < 0 ||
    candidate.x + candidate.dx > type.L ||
    candidate.y + candidate.dy > type.W ||
    candidate.z + candidate.dz > type.H
  ) {
    return fail("超出集装箱内部边界");
  }

  const overlaps: Conflict[] = [];
  for (const p of placements) {
    if (intersect3D(candidate, p)) {
      overlaps.push({ cargoId: p.cargoId, reason: "与现有货物空间重叠" });
    }
  }
  if (overlaps.length) return fail("与现有货物空间重叠", overlaps);

  const support = checkSupport(placements, cargoMap, candidate, candCargo);
  if (!support.ok) return support;

  const dgConflicts: Conflict[] = [];
  for (const p of placements) {
    const other = cargoMap.get(p.cargoId);
    if (!other) continue;
    const reason = dgConflictReason(candCargo.dgClass, other.dgClass);
    if (reason) dgConflicts.push({ cargoId: p.cargoId, reason });
  }
  if (dgConflicts.length) return fail(dgConflicts[0].reason, dgConflicts);

  const used = placements.reduce((s, p) => s + (cargoMap.get(p.cargoId)?.weight ?? 0), 0);
  if (used + candCargo.weight > type.payload) {
    return fail(`超过集装箱载重上限 ${type.payload} kg`);
  }
  return OK;
}

/**
 * 在箱内为货物寻找一个合法位置（极点法）：
 * 候选点取已摆货物右/前/上方的角点，按层低、靠前、靠左排序。
 */
export function findPlacementInContainer(
  type: ContainerType,
  placements: Placement[],
  cargoMap: Map<string, Cargo>,
  cargo: Cargo,
  containerId: string,
): Placement | null {
  const points = new Map<string, { x: number; y: number; z: number }>();
  const add = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x > type.L || y > type.W || z > type.H) return;
    points.set(`${x},${y},${z}`, { x, y, z });
  };
  add(0, 0, 0);
  for (const p of placements) {
    add(p.x + p.dx, p.y, p.z);
    add(p.x, p.y + p.dy, p.z);
    add(p.x, p.y, p.z + p.dz);
  }
  const sorted = [...points.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const orients = orientations(cargo);
  for (const pt of sorted) {
    for (const o of orients) {
      const cand: Placement = { cargoId: cargo.id, containerId, x: pt.x, y: pt.y, z: pt.z, ...o };
      if (validatePlacement(type, placements, cargoMap, cand).ok) return cand;
    }
  }
  return null;
}

/**
 * 重力沉降：给定水平落点与朝向，计算货物落稳后的 z 坐标。
 * 返回 null 表示该水平位置放不下（超高）。
 */
export function settleAt(
  type: ContainerType,
  placements: Placement[],
  cargo: Cargo,
  containerId: string,
  x: number,
  y: number,
  o: OrientedDims,
): Placement | null {
  if (o.dx > type.L || o.dy > type.W || o.dz > type.H) return null;
  const cx = Math.max(0, Math.min(Math.round(x), type.L - o.dx));
  const cy = Math.max(0, Math.min(Math.round(y), type.W - o.dy));
  const ghost: Placement = { cargoId: cargo.id, containerId, x: cx, y: cy, z: 0, ...o };
  let z = 0;
  for (const p of placements) {
    if (footprintOverlap(ghost, p) > 0) z = Math.max(z, p.z + p.dz);
  }
  if (z + o.dz > type.H) return null;
  ghost.z = z;
  return ghost;
}

export interface ContainerStats {
  weight: number;
  volume: number;
  weightPct: number;
  volumePct: number;
  cog: { x: number; y: number; z: number } | null;
  offXPct: number;
  offYPct: number;
}

export function containerStats(
  type: ContainerType,
  placements: Placement[],
  cargoMap: Map<string, Cargo>,
): ContainerStats {
  let weight = 0;
  let volume = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of placements) {
    const c = cargoMap.get(p.cargoId);
    if (!c) continue;
    weight += c.weight;
    volume += p.dx * p.dy * p.dz;
    mx += c.weight * (p.x + p.dx / 2);
    my += c.weight * (p.y + p.dy / 2);
    mz += c.weight * (p.z + p.dz / 2);
  }
  const totalVol = type.L * type.W * type.H;
  const cog = weight > 0 ? { x: mx / weight, y: my / weight, z: mz / weight } : null;
  return {
    weight,
    volume,
    weightPct: Math.min(100, (weight / type.payload) * 100),
    volumePct: Math.min(100, (volume / totalVol) * 100),
    cog,
    offXPct: cog ? ((cog.x - type.L / 2) / (type.L / 2)) * 100 : 0,
    offYPct: cog ? ((cog.y - type.W / 2) / (type.W / 2)) * 100 : 0,
  };
}

export interface PackResult {
  containers: ContainerInst[];
  placements: Placement[];
  unplaced: { cargoId: string; reason: string }[];
  /** 危险品换箱/隔离说明 */
  notes: string[];
}

/** 自动装箱：体积从大到小依次分配，必要时开新箱；危险品不相容自动换箱并记录原因。 */
export function autoPack(cargos: Cargo[], types: ContainerType[]): PackResult {
  const containers: ContainerInst[] = [];
  const placements: Placement[] = [];
  const unplaced: PackResult["unplaced"] = [];
  const notes: string[] = [];
  const cargoMap = new Map(cargos.map((c) => [c.id, c]));
  const sorted = [...cargos].sort(
    (a, b) => b.length * b.width * b.height - a.length * a.width * a.height,
  );
  const typeOf = (id: string) => types.find((t) => t.id === id) ?? null;
  const placementsOf = (cid: string) => placements.filter((p) => p.containerId === cid);
  const usedWeight = (cid: string) =>
    placementsOf(cid).reduce((s, p) => s + (cargoMap.get(p.cargoId)?.weight ?? 0), 0);

  for (const cargo of sorted) {
    let done = false;
    let dgBlock: { boxName: string; otherName: string; reason: string } | null = null;

    for (const inst of containers) {
      const type = typeOf(inst.typeId);
      if (!type) continue;
      if (usedWeight(inst.id) + cargo.weight > type.payload) continue;
      const boxPl = placementsOf(inst.id);
      let dgFail: { name: string; reason: string } | null = null;
      for (const p of boxPl) {
        const other = cargoMap.get(p.cargoId);
        if (!other) continue;
        const reason = dgConflictReason(cargo.dgClass, other.dgClass);
        if (reason) {
          dgFail = { name: other.name, reason };
          break;
        }
      }
      if (dgFail) {
        dgBlock = { boxName: inst.name, otherName: dgFail.name, reason: dgFail.reason };
        continue;
      }
      const found = findPlacementInContainer(type, boxPl, cargoMap, cargo, inst.id);
      if (found) {
        placements.push(found);
        done = true;
        break;
      }
    }
    if (done) continue;

    const fitting = types
      .filter(
        (t) =>
          cargo.weight <= t.payload &&
          orientations(cargo).some((o) => o.dx <= t.L && o.dy <= t.W && o.dz <= t.H),
      )
      .sort((a, b) => a.L * a.W * a.H - b.L * b.W * b.H);
    if (!fitting.length) {
      unplaced.push({ cargoId: cargo.id, reason: "尺寸或重量超出所有可用箱型" });
      continue;
    }
    const inst: ContainerInst = { id: uid(), typeId: fitting[0].id, name: "" };
    containers.push(inst);
    inst.name = `${containers.length}号箱`;
    const found = findPlacementInContainer(fitting[0], [], cargoMap, cargo, inst.id);
    if (found) {
      placements.push(found);
      if (dgBlock) {
        notes.push(
          `「${cargo.name}」与${dgBlock.boxName}内「${dgBlock.otherName}」危险品不相容：${dgBlock.reason}，已改配 ${inst.name}`,
        );
      }
    } else {
      unplaced.push({ cargoId: cargo.id, reason: "箱内空间不足" });
    }
  }
  return { containers, placements, unplaced, notes };
}
