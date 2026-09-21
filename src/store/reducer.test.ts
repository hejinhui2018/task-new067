import { describe, expect, it } from 'vitest';
import { computeSchedule } from '../engine/schedule';
import type { ScheduledRow } from '../engine/schedule';
import type { Segment } from '../types';
import { createInitialHistory, rundownReducer, uid } from './reducer';
import { createDualVenueShow } from './defaultShow';
import { computeShowSchedule } from '../engine/showSchedule';

const rowOf = (segments: Segment[], id: string): ScheduledRow => {
  const row = computeSchedule(segments).rows.find(
    (x): x is ScheduledRow => x.kind === 'segment' && x.segment.id === id,
  );
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};

describe('撤销 / 重做', () => {
  it('修改时长后撤销，时间与消化明细一起恢复；重做后再次生效', () => {
    let h = createInitialHistory();
    const original = computeSchedule(h.present.segments);

    // 采访延长 4 分钟 → 缓冲耗尽 + 新闻被压缩
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'interview', duration: 600 });
    const adjusted = computeSchedule(h.present.segments);
    expect(adjusted.adjustments).toHaveLength(2);
    expect(rowOf(h.present.segments, 'live').startOffset).toBe(900);
    expect(rowOf(h.present.segments, 'buffer').computedDuration).toBe(0);

    h = rundownReducer(h, { type: 'UNDO' });
    expect(computeSchedule(h.present.segments)).toEqual(original);

    h = rundownReducer(h, { type: 'REDO' });
    const redone = computeSchedule(h.present.segments);
    expect(redone.adjustments).toHaveLength(2);
    expect(rowOf(h.present.segments, 'buffer').computedDuration).toBe(0);
    expect(rowOf(h.present.segments, 'news').computedDuration).toBe(180);
  });

  it('冲突状态随撤销/重做一起恢复', () => {
    let h = createInitialHistory();
    // 开场 +7:00，超出消化能力（缓冲 2:00 + 新闻 2:00 + 采访 2:00）→ 冲突 1:00
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'opening', duration: 120 + 420 });
    const withConflict = computeSchedule(h.present.segments);
    expect(withConflict.conflicts).toHaveLength(1);
    expect(withConflict.conflicts[0].overBy).toBe(60);
    expect(rowOf(h.present.segments, 'live').startOffset).toBe(900); // 固定点仍不动

    h = rundownReducer(h, { type: 'UNDO' });
    expect(computeSchedule(h.present.segments).conflicts).toHaveLength(0);

    h = rundownReducer(h, { type: 'REDO' });
    expect(computeSchedule(h.present.segments).conflicts).toHaveLength(1);
  });

  it('空历史时撤销/重做为安全空操作；新修改清空重做栈', () => {
    let h = createInitialHistory();
    expect(rundownReducer(h, { type: 'UNDO' })).toBe(h);
    expect(rundownReducer(h, { type: 'REDO' })).toBe(h);

    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'news', duration: 240 });
    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.future).toHaveLength(1);
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'news', duration: 200 });
    expect(h.future).toHaveLength(0);
  });
});

describe('排序 / 固定点 / 增删', () => {
  it('拖动排序并可撤销', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, { type: 'REORDER', from: 0, to: 3 });
    expect(h.present.segments.map((s) => s.id)).toEqual([
      'news', 'interview', 'opening', 'buffer', 'live', 'comment', 'credits',
    ]);
    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.present.segments.map((s) => s.id)).toEqual([
      'opening', 'news', 'interview', 'buffer', 'live', 'comment', 'credits',
    ]);
  });

  it('设为固定开播点：锁定当前开始时间，不扰动流程', () => {
    let h = createInitialHistory();
    const before = computeSchedule(h.present.segments);

    h = rundownReducer(h, { type: 'TOGGLE_FIXED', id: 'comment' });
    const comment = h.present.segments.find((s) => s.id === 'comment')!;
    expect(comment.kind).toBe('fixed');
    expect(comment.fixedStartOffset).toBe(1200); // 连线 10:15 + 5:00

    const after = computeSchedule(h.present.segments);
    expect(after.conflicts).toHaveLength(0);
    expect(after.adjustments).toHaveLength(0);
    expect(after.rows.map((r) => r.startOffset)).toEqual(before.rows.map((r) => r.startOffset));
    expect(after.endOffset).toBe(before.endOffset);

    h = rundownReducer(h, { type: 'TOGGLE_FIXED', id: 'comment' });
    expect(h.present.segments.find((s) => s.id === 'comment')!.kind).toBe('normal');
  });

  it('时长不会低于环节下限', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'interview', duration: 60 });
    expect(h.present.segments.find((s) => s.id === 'interview')!.duration).toBe(240); // 压缩下限
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'buffer', duration: -10 });
    expect(h.present.segments.find((s) => s.id === 'buffer')!.duration).toBe(0);
  });

  it('插入环节触发重新排程，删除后恢复', () => {
    let h = createInitialHistory();
    const extra: Segment = { id: uid(), title: '快讯', kind: 'normal', duration: 90, minDuration: 0 };
    h = rundownReducer(h, { type: 'INSERT_AT', index: 1, segment: extra });
    expect(h.present.segments[1].id).toBe(extra.id);
    // 多出的 90 秒先由缓冲消化，固定点不动
    expect(rowOf(h.present.segments, 'buffer').computedDuration).toBe(30);
    expect(rowOf(h.present.segments, 'live').startOffset).toBe(900);

    h = rundownReducer(h, { type: 'DELETE', id: extra.id });
    expect(h.present.segments.find((s) => s.id === extra.id)).toBeUndefined();
    expect(computeSchedule(h.present.segments).endOffset).toBe(1800);
  });
});

describe('双场地：跨场地移动与资源', () => {
  const dual = () => createInitialHistory(createDualVenueShow());

  it('把环节从主舞台搬到访谈间：场地归属与排序正确，可撤销', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'MOVE_VENUE', id: 'comment', toVenue: 'B', toIndex: 1 });
    const moved = h.present.segments.find((s) => s.id === 'comment')!;
    expect(moved.venue).toBe('B');
    const bOrder = h.present.segments.filter((s) => s.venue === 'B').map((s) => s.id);
    expect(bOrder[1]).toBe('comment');
    // 主舞台不再包含
    expect(h.present.segments.filter((s) => s.venue === 'A').some((s) => s.id === 'comment')).toBe(false);

    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.present.segments.find((s) => s.id === 'comment')!.venue).toBe('A');
  });

  it('场地内排序只影响该场地，另一场地顺序不变', () => {
    let h = dual();
    const beforeB = h.present.segments.filter((s) => s.venue === 'B').map((s) => s.id);
    h = rundownReducer(h, { type: 'REORDER_VENUE', venue: 'A', from: 0, to: 3 });
    const afterB = h.present.segments.filter((s) => s.venue === 'B').map((s) => s.id);
    expect(afterB).toEqual(beforeB);
    expect(h.present.segments.filter((s) => s.venue === 'A').map((s) => s.id)[2]).toBe('opening');
  });

  it('互换场地只交换归属、保留资源与时长', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'SWAP_VENUE', aId: 'interview', bId: 'b-talk2' });
    const a = h.present.segments.find((s) => s.id === 'interview')!;
    const b = h.present.segments.find((s) => s.id === 'b-talk2')!;
    expect(a.venue).toBe('B');
    expect(b.venue).toBe('A');
    expect(a.resourceIds).toContain('host');
    expect(a.duration).toBe(360);
  });

  it('设置环节共享资源并参与跨场地校验（撤销后冲突消失）', () => {
    let h = dual();
    // 让主舞台开场也占用 guest-zhou：开场 0-120 与访谈间对谈·周启（120 起）首尾相接，不冲突
    h = rundownReducer(h, { type: 'SET_SEGMENT_RESOURCES', id: 'opening', resourceIds: ['guest-zhou'] });
    expect(computeShowSchedule(h.present).resourceConflicts).toHaveLength(0);
    // 开场延长到 240 → 与周启 120-240… 对谈到 600，重叠 120-240
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'opening', duration: 240 });
    const conflicts = computeShowSchedule(h.present).resourceConflicts;
    expect(conflicts.some((c) => c.resourceIds.includes('guest-zhou'))).toBe(true);

    h = rundownReducer(h, { type: 'UNDO' }); // 撤销延长
    expect(computeShowSchedule(h.present).resourceConflicts).toHaveLength(0);
    h = rundownReducer(h, { type: 'UNDO' }); // 撤销资源绑定
    expect(h.present.segments.find((s) => s.id === 'opening')!.resourceIds ?? []).toEqual([]);
  });

  it('删除资源时自动从所有环节解绑', () => {
    let h = dual();
    expect(h.present.resources!.some((r) => r.id === 'van')).toBe(true);
    h = rundownReducer(h, { type: 'DELETE_RESOURCE', id: 'van' });
    expect(h.present.resources!.some((r) => r.id === 'van')).toBe(false);
    expect(h.present.segments.every((s) => !(s.resourceIds ?? []).includes('van'))).toBe(true);
  });

  it('BATCH 多个动作只产生一个撤销快照（建议一键采用）', () => {
    let h = dual();
    const pastBefore = h.past.length;
    h = rundownReducer(h, {
      type: 'BATCH',
      actions: [
        { type: 'UPDATE_DURATION', id: 'b-buf', duration: 60 },
        { type: 'UPDATE_DURATION', id: 'b-talk1', duration: 420 },
      ],
    });
    expect(h.past.length).toBe(pastBefore + 1);
    expect(h.present.segments.find((s) => s.id === 'b-buf')!.duration).toBe(60);
    expect(h.present.segments.find((s) => s.id === 'b-talk1')!.duration).toBe(420);
    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.present.segments.find((s) => s.id === 'b-buf')!.duration).toBe(180);
    expect(h.present.segments.find((s) => s.id === 'b-talk1')!.duration).toBe(480);
  });
});

describe('双场地：已执行前缀锁定', () => {
  const dual = () => createInitialHistory(createDualVenueShow());

  it('锁定前缀：按当前实际时刻锚定，之后改时长不会移动锁定行', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'LOCK_PREFIX', venue: 'A', upToId: 'news' });
    const locked = h.present.segments.filter((s) => s.venue === 'A').slice(0, 2);
    expect(locked.every((s) => s.locked)).toBe(true);
    expect(locked[1].actualStartOffset).toBe(120);
    expect(locked[1].actualEndOffset).toBe(420);

    // 锁定后再改开场时长：锚点不动，编辑被拒绝
    h = rundownReducer(h, { type: 'UPDATE_DURATION', id: 'opening', duration: 600 });
    expect(h.present.segments.find((s) => s.id === 'opening')!.duration).toBe(120);
    // 锁定行不可删、不可跨场地移动
    h = rundownReducer(h, { type: 'DELETE', id: 'opening' });
    expect(h.present.segments.some((s) => s.id === 'opening')).toBe(true);
    h = rundownReducer(h, { type: 'MOVE_VENUE', id: 'news', toVenue: 'B', toIndex: 0 });
    expect(h.present.segments.find((s) => s.id === 'news')!.venue).toBe('A');
  });

  it('锁定前缀后新环节只能插入未锁定后缀，不能落进前缀', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'LOCK_PREFIX', venue: 'A', upToId: 'interview' });
    const extra: Segment = { id: uid(), title: '插单', kind: 'normal', duration: 60, minDuration: 0, venue: 'A' };
    // 试图插到场地索引 1（前缀内部）→ 被钳制到第一个未锁定位置（buffer，索引 3）
    h = rundownReducer(h, { type: 'INSERT_IN_VENUE', venue: 'A', index: 1, segment: extra });
    const aOrder = h.present.segments.filter((s) => s.venue === 'A').map((s) => s.id);
    expect(aOrder.indexOf(extra.id)).toBeGreaterThanOrEqual(3);
  });

  it('解锁场地清除全部锚点，排程恢复整体顺延（可撤销）', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'LOCK_PREFIX', venue: 'B', upToId: 'b-talk1' });
    expect(h.present.segments.filter((s) => s.venue === 'B' && s.locked)).toHaveLength(2);
    h = rundownReducer(h, { type: 'UNLOCK_VENUE', venue: 'B' });
    const bSegs = h.present.segments.filter((s) => s.venue === 'B');
    expect(bSegs.every((s) => !s.locked && s.actualStartOffset === undefined)).toBe(true);

    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.present.segments.filter((s) => s.venue === 'B' && s.locked)).toHaveLength(2);
  });

  it('锁定前缀不影响另一场地', () => {
    let h = dual();
    h = rundownReducer(h, { type: 'LOCK_PREFIX', venue: 'A', upToId: 'buffer' });
    // B 场地无锁定，仍可自由重排
    const bBefore = h.present.segments.filter((s) => s.venue === 'B').map((s) => s.id);
    h = rundownReducer(h, { type: 'REORDER_VENUE', venue: 'B', from: 0, to: 2 });
    const bAfter = h.present.segments.filter((s) => s.venue === 'B').map((s) => s.id);
    expect(bAfter).not.toEqual(bBefore);
    // A 场地前缀内重排被拒
    const aBefore = h.present.segments.filter((s) => s.venue === 'A').map((s) => s.id);
    h = rundownReducer(h, { type: 'REORDER_VENUE', venue: 'A', from: 0, to: 5 });
    const aAfter = h.present.segments.filter((s) => s.venue === 'A').map((s) => s.id);
    expect(aAfter).toEqual(aBefore);
  });
});

describe('双场地：持久化', () => {
  it('v1 单时间线数据迁移到主舞台 A，保留环节与固定点', async () => {
    const v1 = {
      past: [],
      present: {
        showName: '旧节目',
        showStartSeconds: 36000,
        slotDuration: 1800,
        segments: [
          { id: 'x', title: 'X', kind: 'normal' as const, duration: 100, minDuration: 0 },
          { id: 'f', title: 'F', kind: 'fixed' as const, duration: 60, minDuration: 0, fixedStartOffset: 200 },
        ],
      },
      future: [],
    };
    const storage: Record<string, string> = { 'rundown-console:v1': JSON.stringify(v1) };
    const localStorageMock = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v;
      },
    };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
    try {
      const { loadHistory } = await import('./persistence');
      const h = loadHistory()!;
      expect(h.present.segments.every((s) => s.venue === 'A')).toBe(true);
      expect(h.present.venues).toEqual([{ id: 'A', name: '主舞台' }]);
      expect(h.present.resources).toEqual([]);
      expect(h.present.showName).toBe('旧节目');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });
});
