import type { RundownState } from '../types';

/**
 * 内置节目单：10:00 开播的 30 分钟直播。
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
