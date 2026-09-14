import type { ContainerType, DgClass, RotationMode } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** 常用集装箱内尺寸（cm）与载重（kg） */
export const CONTAINER_TYPES: ContainerType[] = [
  { id: "20GP", name: "20尺普柜 20GP", L: 589, W: 235, H: 239, payload: 21740 },
  { id: "40GP", name: "40尺普柜 40GP", L: 1203, W: 235, H: 239, payload: 26630 },
  { id: "40HQ", name: "40尺高柜 40HQ", L: 1203, W: 235, H: 269, payload: 26520 },
];

export const ROTATION_MODES: { id: RotationMode; label: string }[] = [
  { id: "none", label: "不可旋转" },
  { id: "horizontal", label: "仅水平旋转" },
  { id: "full", label: "六面自由旋转" },
];

export const DG_CLASSES: { id: DgClass; label: string; color: string }[] = [
  { id: "none", label: "普通货物", color: "#4f7fb5" },
  { id: "1", label: "1类 爆炸品", color: "#7e57c2" },
  { id: "3", label: "3类 易燃液体", color: "#d64541" },
  { id: "4", label: "4类 易燃固体", color: "#e08e0b" },
  { id: "5.1", label: "5.1类 氧化剂", color: "#c2185b" },
  { id: "6.1", label: "6.1类 毒性物质", color: "#00695c" },
  { id: "8", label: "8类 腐蚀品", color: "#5d4037" },
  { id: "9", label: "9类 杂项危险品", color: "#607d8b" },
];

export function dgColor(id: DgClass): string {
  return DG_CLASSES.find((d) => d.id === id)?.color ?? "#4f7fb5";
}

export function dgLabel(id: DgClass): string {
  return DG_CLASSES.find((d) => d.id === id)?.label ?? id;
}

/**
 * 危险品隔离表（简化自 IMDG 隔离要求，可按需扩展）。
 * 返回不相容原因；相容返回 null。
 */
const DG_PAIRS: [DgClass, DgClass, string][] = [
  ["3", "5.1", "氧化剂(5.1类)会助燃易燃液体(3类)，须分箱装载"],
  ["4", "5.1", "氧化剂(5.1类)会加剧易燃固体(4类)燃烧，须分箱装载"],
  ["3", "8", "腐蚀品(8类)泄漏会破坏易燃液体(3类)包装，须分箱装载"],
  ["5.1", "8", "氧化剂(5.1类)与腐蚀品(8类)混合有剧烈反应风险，须分箱装载"],
  ["6.1", "8", "腐蚀品(8类)泄漏会加大毒性物质(6.1类)扩散风险，须分箱装载"],
];

export function dgConflictReason(a: DgClass, b: DgClass): string | null {
  if (a === "none" || b === "none") return null;
  if (a === "1" || b === "1") {
    return "爆炸品(1类)须单独装箱，不得与其他危险品同箱";
  }
  for (const [x, y, reason] of DG_PAIRS) {
    if ((a === x && b === y) || (a === y && b === x)) return reason;
  }
  return null;
}
