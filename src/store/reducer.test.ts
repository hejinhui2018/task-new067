import { describe, expect, it } from 'vitest';
import { computeSchedule } from '../engine/schedule';
import type { ScheduledRow } from '../engine/schedule';
import type { Segment } from '../types';
import { createInitialHistory, rundownReducer, uid } from './reducer';

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
