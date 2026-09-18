/** 环节类型：常规 / 可压缩 / 缓冲 / 固定开播点 */
export type SegmentKind = 'normal' | 'compressible' | 'buffer' | 'fixed';

export interface Segment {
  id: string;
  title: string;
  kind: SegmentKind;
  /** 计划时长（秒） */
  duration: number;
  /** 可压缩下限（秒），仅 compressible 有意义；buffer 恒为 0 */
  minDuration: number;
  /** 固定开播点：距开播的偏移秒数，仅 kind === 'fixed' 时存在 */
  fixedStartOffset?: number;
}

export interface RundownState {
  showName: string;
  /** 开播时刻：自当日 00:00 起的秒数 */
  showStartSeconds: number;
  /** 播出窗口时长（秒），用于计算总时长偏差 */
  slotDuration: number;
  segments: Segment[];
}
