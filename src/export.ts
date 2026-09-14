import type { Cargo, ContainerInst, ContainerType, Placement } from "./types";
import { dgLabel } from "./data";
import { containerStats } from "./packer";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename: string, content: string): void {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export interface ExportData {
  cargos: Cargo[];
  containers: ContainerInst[];
  placements: Placement[];
  types: ContainerType[];
  unplacedReasons: Record<string, string>;
}

/** 最终装载清单：逐件货物的箱号、位置、朝向、危险品属性 */
export function exportManifest(data: ExportData): void {
  const cargoMap = new Map(data.cargos.map((c) => [c.id, c]));
  const typeOf = (id: string) => data.types.find((t) => t.id === id);
  const rows: (string | number)[][] = [
    ["箱号", "箱型", "货物", "危险品", "原始尺寸 长×宽×高(cm)", "放置尺寸(cm)", "重量(kg)", "位置X(cm)", "位置Y(cm)", "位置Z(cm)", "堆码承重上限(kg)"],
  ];
  const sorted = [...data.placements].sort((a, b) => {
    const ca = data.containers.find((c) => c.id === a.containerId)?.name ?? "";
    const cb = data.containers.find((c) => c.id === b.containerId)?.name ?? "";
    return ca.localeCompare(cb) || a.z - b.z || a.y - b.y || a.x - b.x;
  });
  for (const p of sorted) {
    const cargo = cargoMap.get(p.cargoId);
    if (!cargo) continue;
    const inst = data.containers.find((c) => c.id === p.containerId);
    rows.push([
      inst?.name ?? "-",
      inst ? (typeOf(inst.typeId)?.name ?? inst.typeId) : "-",
      cargo.name,
      dgLabel(cargo.dgClass),
      `${cargo.length}×${cargo.width}×${cargo.height}`,
      `${p.dx}×${p.dy}×${p.dz}`,
      cargo.weight,
      p.x,
      p.y,
      p.z,
      cargo.stackLimit,
    ]);
  }
  const placedIds = new Set(data.placements.map((p) => p.cargoId));
  for (const cargo of data.cargos) {
    if (placedIds.has(cargo.id)) continue;
    rows.push([
      "未装箱",
      "-",
      cargo.name,
      dgLabel(cargo.dgClass),
      `${cargo.length}×${cargo.width}×${cargo.height}`,
      "-",
      cargo.weight,
      "-",
      "-",
      "-",
      cargo.stackLimit,
    ]);
  }
  download(`装载清单_${stamp()}.csv`, toCsv(rows));
}

/** 各箱利用率与重心汇总 */
export function exportUtilization(data: ExportData): void {
  const cargoMap = new Map(data.cargos.map((c) => [c.id, c]));
  const rows: (string | number)[][] = [
    ["箱号", "箱型", "内尺寸(cm)", "件数", "总体积(m³)", "体积利用率%", "总重(kg)", "载重利用率%", "重心偏移X%", "重心偏移Y%", "状态"],
  ];
  for (const inst of data.containers) {
    const type = data.types.find((t) => t.id === inst.typeId);
    if (!type) continue;
    const pl = data.placements.filter((p) => p.containerId === inst.id);
    const s = containerStats(type, pl, cargoMap);
    const warn = Math.abs(s.offXPct) > 10 || Math.abs(s.offYPct) > 10;
    rows.push([
      inst.name,
      type.name,
      `${type.L}×${type.W}×${type.H}`,
      pl.length,
      (s.volume / 1e6).toFixed(2),
      s.volumePct.toFixed(1),
      s.weight,
      s.weightPct.toFixed(1),
      s.offXPct.toFixed(1),
      s.offYPct.toFixed(1),
      warn ? "重心偏移过大" : "正常",
    ]);
  }
  download(`各箱利用率_${stamp()}.csv`, toCsv(rows));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
