export type RotationMode = "none" | "horizontal" | "full";

export type DgClass = "none" | "1" | "3" | "4" | "5.1" | "6.1" | "8" | "9";

/** 货物主数据。尺寸单位 cm，重量单位 kg。 */
export interface Cargo {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  /** 可旋转方式：不可旋转 / 仅水平旋转 / 六面自由旋转 */
  rotation: RotationMode;
  /** 危险品类别，none 为普通货物 */
  dgClass: DgClass;
  /** 堆码承重上限：允许压在本货物顶部的最大直接重量 kg，0 表示不可堆压 */
  stackLimit: number;
}

/** 一件货物在箱内的实际摆放（已按朝向换算后的尺寸）。 */
export interface Placement {
  cargoId: string;
  containerId: string;
  /** 箱内坐标，cm。x 沿箱长、y 沿箱宽、z 沿高度 */
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ContainerType {
  id: string;
  name: string;
  /** 内部尺寸 cm */
  L: number;
  W: number;
  H: number;
  /** 最大载重 kg */
  payload: number;
}

export interface ContainerInst {
  id: string;
  typeId: string;
  name: string;
}
