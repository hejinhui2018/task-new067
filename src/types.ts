/** 环节类型：常规 / 可压缩 / 缓冲 / 固定开播点 */
export type SegmentKind = 'normal' | 'compressible' | 'buffer' | 'fixed';

/** 环节时长下限（秒）：缓冲可到 0，可压缩环节不低于其压缩下限，其余不低于此值 */
export const MIN_SEGMENT_DURATION = 30;

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
  /**
   * 占用的共享资源（嘉宾、主持人、转播车……）。
   * 同一资源在不同场地的排程区间不得重叠，否则报资源冲突。
   */
  resources: string[];
}

/** 一个场地（如主舞台、访谈间）拥有自己独立的时间线 */
export interface Venue {
  id: string;
  name: string;
  segments: Segment[];
}

export interface RundownState {
  showName: string;
  /** 开播时刻：自当日 00:00 起的秒数（所有场地共用同一挂钟） */
  showStartSeconds: number;
  /** 播出窗口时长（秒），用于计算总时长偏差 */
  slotDuration: number;
  /** 各场地时间线，可独立调整 */
  venues: Venue[];
  /**
   * 已执行前缀锁定：venueId → 距开播的偏移秒数。
   * 排程开始时刻早于该值的环节视为「已执行」，不可修改、删除、移动，
   * 也不会被引擎压缩消化（已播出的内容不能改写）。
   */
  executedUntil: Record<string, number>;
}
