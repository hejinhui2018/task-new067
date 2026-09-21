/** 环节类型：常规 / 可压缩 / 缓冲 / 固定开播点 */
export type SegmentKind = 'normal' | 'compressible' | 'buffer' | 'fixed';

/** 场地标识：主舞台 / 访谈间 */
export type VenueId = 'A' | 'B';

export interface Venue {
  id: VenueId;
  name: string;
}

/** 共享资源种类：人员（嘉宾/主持人）或设备（转播车、机位等） */
export type ResourceKind = 'person' | 'equipment';

/**
 * 跨场地共享资源：同一种资源在同一时刻只能被一个场地的一个环节占用。
 * 场地专属资源（如某舞台自带的灯光）不必登记。
 */
export interface SharedResource {
  id: string;
  name: string;
  kind: ResourceKind;
}

export interface Segment {
  id: string;
  title: string;
  kind: SegmentKind;
  /** 所属场地，缺省视为 'A'，兼容旧版单时间线数据 */
  venue?: VenueId;
  /** 占用的共享资源 id 列表 */
  resourceIds?: string[];
  /** 计划时长（秒） */
  duration: number;
  /** 可压缩下限（秒），仅 compressible 有意义；buffer 恒为 0 */
  minDuration: number;
  /** 固定开播点：距开播的偏移秒数，仅 kind === 'fixed' 时存在 */
  fixedStartOffset?: number;
  /**
   * 已执行锁定：存在时该行按实际时刻锚定，引擎不再因计划变更移动它。
   * 锁定的环节构成连续的「已执行前缀」，前缀之后的修改不会倒灌进前缀。
   */
  locked?: boolean;
  actualStartOffset?: number;
  actualEndOffset?: number;
}

export interface RundownState {
  showName: string;
  /** 开播时刻：自当日 00:00 起的秒数 */
  showStartSeconds: number;
  /** 播出窗口时长（秒），用于计算总时长偏差 */
  slotDuration: number;
  segments: Segment[];
  /** 场地列表；缺省（旧数据）等价于主舞台 A 单场地 */
  venues?: Venue[];
  /** 跨场地共享资源台账 */
  resources?: SharedResource[];
}
