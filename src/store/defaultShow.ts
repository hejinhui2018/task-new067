import type { RundownState, SharedResource, Venue } from '../types';

/** 共享资源台账：主持人、两位嘉宾与转播车在两个场地间复用 */
export const DEFAULT_RESOURCES: SharedResource[] = [
  { id: 'host', name: '主持人·苏眉', kind: 'person' },
  { id: 'guest-lin', name: '嘉宾·林澜', kind: 'person' },
  { id: 'guest-zhou', name: '嘉宾·周启', kind: 'person' },
  { id: 'van', name: '转播车 1 号', kind: 'equipment' },
];

export const DEFAULT_VENUES: Venue[] = [
  { id: 'A', name: '主舞台' },
  { id: 'B', name: '访谈间' },
];

/**
 * 内置单场地节目单：10:00 开播的 30 分钟直播（主舞台流程，保持原有节奏与固定点）。
 * 开场 2:00 + 新闻 5:00 + 采访 6:00 + 缓冲 2:00 = 15:00 → 连线固定 10:15 开播
 * 连线 5:00 + 评论 8:00 + 片尾 2:00 = 15:00 → 10:30 准点收尾
 */
export function createDefaultShow(): RundownState {
  return {
    showName: '晚间直播',
    showStartSeconds: 10 * 3600,
    slotDuration: 30 * 60,
    segments: [
      { id: 'opening',   title: '开场', kind: 'normal',       duration: 120, minDuration: 0 },
      { id: 'news',      title: '新闻', kind: 'compressible', duration: 300, minDuration: 180 },
      { id: 'interview', title: '采访', kind: 'compressible', duration: 360, minDuration: 240 },
      { id: 'buffer',    title: '缓冲', kind: 'buffer',       duration: 120, minDuration: 0 },
      { id: 'live',      title: '连线', kind: 'fixed',        duration: 300, minDuration: 0, fixedStartOffset: 900 },
      { id: 'comment',   title: '评论', kind: 'normal',       duration: 480, minDuration: 0 },
      { id: 'credits',   title: '片尾', kind: 'normal',       duration: 120, minDuration: 0 },
    ],
  };
}

/**
 * 双场地联排节目单（10:00–10:30 窗口）：
 *
 * 主舞台 A：开场 → 新闻 → 采访（主持人+林澜）→ 缓冲 → ⚓10:15 转播车连线 → 评论（主持人）→ 片尾
 * 访谈间 B：间场开场 → 对谈·周启 → 缓冲 → 联合对谈（主持人+林澜+周启）→ ⚓10:21 转播车连线 → 收场
 *
 * 初始排布无冲突：主持人/林澜 780 秒从主舞台切到访谈间、1200 秒切回评论；
 * 转播车 10:20 在主舞台用完，10:21 才进访谈间。
 * 一旦主舞台采访临时延长，除了本场地消化固定点超时，还会立刻撞上访谈间的联合对谈。
 */
export function createDualVenueShow(): RundownState {
  return {
    showName: '晚间直播·双场地联排',
    showStartSeconds: 10 * 3600,
    slotDuration: 30 * 60,
    venues: DEFAULT_VENUES,
    resources: DEFAULT_RESOURCES,
    segments: [
      // —— 主舞台 A ——
      { id: 'opening',   title: '开场',           venue: 'A', kind: 'normal',       duration: 120, minDuration: 0,   resourceIds: [] },
      { id: 'news',      title: '新闻',           venue: 'A', kind: 'compressible', duration: 300, minDuration: 180, resourceIds: [] },
      { id: 'interview', title: '采访·林澜',      venue: 'A', kind: 'compressible', duration: 360, minDuration: 240, resourceIds: ['host', 'guest-lin'] },
      { id: 'buffer',    title: '缓冲',           venue: 'A', kind: 'buffer',       duration: 120, minDuration: 0,   resourceIds: [] },
      { id: 'live',      title: '转播车连线',     venue: 'A', kind: 'fixed',        duration: 300, minDuration: 0,   fixedStartOffset: 900,  resourceIds: ['van'] },
      { id: 'comment',   title: '评论',           venue: 'A', kind: 'normal',       duration: 480, minDuration: 0,   resourceIds: ['host'] },
      { id: 'credits',   title: '片尾',           venue: 'A', kind: 'normal',       duration: 120, minDuration: 0,   resourceIds: [] },

      // —— 访谈间 B ——
      { id: 'b-open',  title: '间场开场',       venue: 'B', kind: 'normal',       duration: 120, minDuration: 0,   resourceIds: [] },
      { id: 'b-talk1', title: '对谈·周启',      venue: 'B', kind: 'compressible', duration: 480, minDuration: 300, resourceIds: ['guest-zhou'] },
      { id: 'b-buf',   title: '访谈缓冲',       venue: 'B', kind: 'buffer',       duration: 180, minDuration: 0,   resourceIds: [] },
      { id: 'b-talk2', title: '联合对谈',       venue: 'B', kind: 'normal',       duration: 420, minDuration: 0,   resourceIds: ['host', 'guest-lin', 'guest-zhou'] },
      { id: 'b-live',  title: '转播车访谈连线', venue: 'B', kind: 'fixed',        duration: 240, minDuration: 0,   fixedStartOffset: 1260, resourceIds: ['van'] },
      { id: 'b-end',   title: '收场',           venue: 'B', kind: 'normal',       duration: 120, minDuration: 0,   resourceIds: [] },
    ],
  };
}
