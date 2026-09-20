import type { RundownState } from '../types';

/**
 * 内置节目单：10:00 开播的 30 分钟直播，双场地联排。
 *
 * 主舞台：开场 2:00 + 新闻 5:00 + 采访 6:00 + 缓冲 2:00 = 15:00 → 连线固定 10:15
 *         连线 5:00 + 评论 8:00 + 片尾 2:00 → 10:30 准点收尾
 * 访谈间：布置 3:00 + 预热 4:00 + 缓冲 6:00 → 嘉宾专访 10:13 接上主舞台采访下场的嘉宾
 *
 * 共享资源：嘉宾-陈（主舞台采访 10:07–10:13 → 访谈间专访 10:13–10:19，无缝衔接）、
 * 转播车1（主舞台连线 10:15–10:20 → 访谈间设备转场 10:22–10:23）。
 * 临时延长主舞台采访，嘉宾-陈 的冲突会立刻出现在访谈间一侧。
 */
export function createDefaultShow(): RundownState {
  return {
    showName: '晚间直播',
    showStartSeconds: 10 * 3600,
    slotDuration: 30 * 60,
    venues: [
      {
        id: 'main',
        name: '主舞台',
        segments: [
          { id: 'opening',   title: '开场', kind: 'normal',       duration: 120, minDuration: 0,   resources: ['主持人A'] },
          { id: 'news',      title: '新闻', kind: 'compressible', duration: 300, minDuration: 180, resources: ['主持人A'] },
          { id: 'interview', title: '采访', kind: 'compressible', duration: 360, minDuration: 240, resources: ['主持人A', '嘉宾-陈'] },
          { id: 'buffer',    title: '缓冲', kind: 'buffer',       duration: 120, minDuration: 0,   resources: [] },
          { id: 'live',      title: '连线', kind: 'fixed',        duration: 300, minDuration: 0,   resources: ['主持人A', '转播车1'], fixedStartOffset: 900 },
          { id: 'comment',   title: '评论', kind: 'normal',       duration: 480, minDuration: 0,   resources: ['主持人A', '评论员'] },
          { id: 'credits',   title: '片尾', kind: 'normal',       duration: 120, minDuration: 0,   resources: ['主持人A'] },
        ],
      },
      {
        id: 'interview-room',
        name: '访谈间',
        segments: [
          { id: 'ir-setup',   title: '场地布置', kind: 'normal',       duration: 180, minDuration: 0,   resources: [] },
          { id: 'ir-warmup',  title: '预热对谈', kind: 'compressible', duration: 240, minDuration: 120, resources: ['主持人B'] },
          { id: 'ir-buffer',  title: '缓冲',     kind: 'buffer',       duration: 360, minDuration: 0,   resources: [] },
          { id: 'ir-guest',   title: '嘉宾专访', kind: 'compressible', duration: 360, minDuration: 240, resources: ['嘉宾-陈', '主持人B'] },
          { id: 'ir-audience',title: '观众互动', kind: 'normal',       duration: 180, minDuration: 0,   resources: ['主持人B'] },
          { id: 'ir-truck',   title: '设备转场', kind: 'normal',       duration: 60,  minDuration: 0,   resources: ['转播车1'] },
          { id: 'ir-wrap',    title: '录播收尾', kind: 'normal',       duration: 120, minDuration: 0,   resources: [] },
        ],
      },
    ],
    executedUntil: {},
  };
}
