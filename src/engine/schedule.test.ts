import { describe, expect, it } from 'vitest';
import { computeSchedule } from './schedule';
import type { GapRow, ScheduleResult, ScheduledRow } from './schedule';
import type { Segment } from '../types';
import { createDefaultShow } from '../store/defaultShow';

const seg = (s: Partial<Segment> & { id: string }): Segment => ({
  title: s.id,
  kind: 'normal',
  duration: 60,
  minDuration: 0,
  ...s,
});

const rowOf = (r: ScheduleResult, id: string): ScheduledRow => {
  const row = r.rows.find((x): x is ScheduledRow => x.kind === 'segment' && x.segment.id === id);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};

const gapOf = (r: ScheduleResult): GapRow | undefined =>
  r.rows.find((x): x is GapRow => x.kind === 'gap');

describe('时间传播（整体顺延）', () => {
  it('无固定点时，延长环节使其后所有环节顺延', () => {
    const before = computeSchedule([
      seg({ id: 'a', duration: 60 }),
      seg({ id: 'b', duration: 120 }),
      seg({ id: 'c', duration: 60 }),
    ]);
    const after = computeSchedule([
      seg({ id: 'a', duration: 60 }),
      seg({ id: 'b', duration: 150 }),
      seg({ id: 'c', duration: 60 }),
    ]);
    expect(rowOf(after, 'c').startOffset).toBe(rowOf(before, 'c').startOffset + 30);
    expect(after.endOffset).toBe(before.endOffset + 30);
    expect(after.conflicts).toHaveLength(0);
    expect(after.adjustments).toHaveLength(0);
  });

  it('固定点之后的调整不影响固定点本身，只顺延尾部', () => {
    const show = createDefaultShow();
    const extended = show.segments.map((s) =>
      s.id === 'comment' ? { ...s, duration: s.duration + 120 } : s,
    );
    const r = computeSchedule(extended);
    expect(rowOf(r, 'live').startOffset).toBe(900); // 连线仍 10:15
    expect(rowOf(r, 'credits').startOffset).toBe(1800); // 片尾顺延 2 分钟
    expect(r.endOffset).toBe(1920);
    expect(r.conflicts).toHaveLength(0);
  });
});

describe('固定点：缓冲与压缩消化超时', () => {
  it('采访延长 4 分钟：缓冲耗尽、新闻被压缩、连线与片尾准点', () => {
    const show = createDefaultShow();
    const extended = show.segments.map((s) =>
      s.id === 'interview' ? { ...s, duration: s.duration + 240 } : s,
    );
    const r = computeSchedule(extended);

    expect(rowOf(r, 'live').startOffset).toBe(900); // 固定点不动
    expect(rowOf(r, 'buffer').computedDuration).toBe(0); // 缓冲 2:00 → 0:00
    expect(rowOf(r, 'buffer').compressedBy).toBe(120);
    expect(rowOf(r, 'news').computedDuration).toBe(180); // 新闻 5:00 → 3:00（到下限）
    expect(rowOf(r, 'news').compressedBy).toBe(120);
    expect(rowOf(r, 'interview').computedDuration).toBe(600); // 采访保持 10:00
    expect(r.conflicts).toHaveLength(0);
    expect(r.endOffset).toBe(1800); // 片尾不受影响

    // 先消耗缓冲，再压缩可压缩环节
    expect(r.adjustments.map((a) => a.segmentId)).toEqual(['buffer', 'news']);
    expect(r.adjustments[0]).toMatchObject({ from: 120, to: 0, absorbed: 120 });
    expect(r.adjustments[1]).toMatchObject({ from: 300, to: 180, absorbed: 120 });
    // 计划时长不被引擎修改
    expect(rowOf(r, 'buffer').plannedDuration).toBe(120);
    expect(rowOf(r, 'news').plannedDuration).toBe(300);
  });

  it('小超时只消耗缓冲，不动可压缩环节', () => {
    const show = createDefaultShow();
    const extended = show.segments.map((s) =>
      s.id === 'interview' ? { ...s, duration: s.duration + 120 } : s,
    );
    const r = computeSchedule(extended);
    expect(rowOf(r, 'buffer').computedDuration).toBe(0);
    expect(rowOf(r, 'news').computedDuration).toBe(300);
    expect(r.adjustments).toHaveLength(1);
    expect(rowOf(r, 'live').startOffset).toBe(900);
  });

  it('压缩不会超过环节下限', () => {
    const show = createDefaultShow();
    // 开场 +6:00，恰好等于消化能力上限（缓冲 2:00 + 新闻 2:00 + 采访 2:00）
    const extended = show.segments.map((s) =>
      s.id === 'opening' ? { ...s, duration: s.duration + 360 } : s,
    );
    const r = computeSchedule(extended);
    expect(rowOf(r, 'buffer').computedDuration).toBe(0);
    expect(rowOf(r, 'news').computedDuration).toBe(180); // 压到下限
    expect(rowOf(r, 'interview').computedDuration).toBe(240); // 压到下限
    expect(r.conflicts).toHaveLength(0);
    expect(rowOf(r, 'live').startOffset).toBe(900);
  });
});

describe('固定点冲突', () => {
  it('消化能力耗尽时明确报冲突，固定点不被越过', () => {
    const r = computeSchedule([
      seg({ id: 'a', kind: 'compressible', duration: 600, minDuration: 120 }),
      seg({ id: 'b', kind: 'buffer', duration: 60 }),
      seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 60 }),
      seg({ id: 'tail', duration: 60 }),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0];
    expect(c.fixedSegmentId).toBe('f');
    expect(c.overflow).toBe(600); // 自然开始 660 - 固定点 60
    expect(c.absorbed).toBe(540); // a 让出 480 + b 让出 60
    expect(c.overBy).toBe(60);
    expect(c.overflowingSegmentIds).toContain('a');

    expect(rowOf(r, 'a').computedDuration).toBe(120); // 压到下限为止
    expect(rowOf(r, 'b').computedDuration).toBe(0);
    expect(rowOf(r, 'f').startOffset).toBe(60); // 固定点不动
    expect(rowOf(r, 'tail').startOffset).toBe(120); // 后续环节以固定点为准继续
  });

  it('没有可压缩空间时，全部超时都报为冲突', () => {
    const r = computeSchedule([
      seg({ id: 'a', duration: 300 }),
      seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 120 }),
    ]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].overBy).toBe(180);
    expect(r.conflicts[0].absorbed).toBe(0);
    expect(rowOf(r, 'f').startOffset).toBe(120);
  });
});

describe('空档与多固定点', () => {
  it('固定点前内容不足时留出空档，固定点仍准点', () => {
    const show = createDefaultShow();
    const shortened = show.segments.map((s) =>
      s.id === 'news' ? { ...s, duration: 120 } : s,
    );
    const r = computeSchedule(shortened);
    const gap = gapOf(r);
    expect(gap).toBeDefined();
    expect(gap!.duration).toBe(180);
    expect(gap!.beforeFixedSegmentId).toBe('live');
    expect(rowOf(r, 'live').startOffset).toBe(900);
    expect(r.endOffset).toBe(1800);
  });

  it('超时只从同一区段（上一个固定点之后）消化', () => {
    const r = computeSchedule([
      seg({ id: 'a', duration: 300 }),
      seg({ id: 'f1', kind: 'fixed', duration: 60, fixedStartOffset: 300 }),
      seg({ id: 'b2', kind: 'buffer', duration: 120 }),
      seg({ id: 'c2', kind: 'compressible', duration: 300, minDuration: 60 }),
      seg({ id: 'f2', kind: 'fixed', duration: 60, fixedStartOffset: 480 }),
      seg({ id: 'tail', duration: 60 }),
    ]);
    // f2 自然开始 = 360+120+300 = 780，超时 300，由本区段 b2(120) + c2(180) 消化
    expect(rowOf(r, 'b2').computedDuration).toBe(0);
    expect(rowOf(r, 'c2').computedDuration).toBe(120);
    expect(rowOf(r, 'f2').startOffset).toBe(480);
    expect(rowOf(r, 'a').computedDuration).toBe(300); // 上一区段不受影响
    expect(r.conflicts).toHaveLength(0);
    expect(r.adjustments.map((x) => x.segmentId)).toEqual(['b2', 'c2']);
  });
});

describe('余量统计', () => {
  it('缓冲余量与可消化余量', () => {
    const r = computeSchedule(createDefaultShow().segments);
    expect(r.bufferRemaining).toBe(120);
    expect(r.absorbableRemaining).toBe(120 + (300 - 180) + (360 - 240)); // 360
    expect(r.totalPlanned).toBe(1800);
    expect(r.endOffset).toBe(1800);
  });
});

describe('已执行锁定前缀', () => {
  it('锁定行按实际时刻锚定：前序环节延长不会推动它，后续环节也不倒灌', () => {
    const r = computeSchedule([
      seg({ id: 'a', duration: 120 }),
      seg({ id: 'lk', duration: 120, locked: true, actualStartOffset: 120, actualEndOffset: 240 }),
      seg({ id: 'c', duration: 120 }),
    ]);
    // 前序 a 延长 180 秒
    const r2 = computeSchedule([
      seg({ id: 'a', duration: 300 }),
      seg({ id: 'lk', duration: 120, locked: true, actualStartOffset: 120, actualEndOffset: 240 }),
      seg({ id: 'c', duration: 120 }),
    ]);
    expect(rowOf(r, 'lk').startOffset).toBe(120);
    expect(rowOf(r2, 'lk').startOffset).toBe(120); // 锚点纹丝不动
    expect(rowOf(r2, 'lk').locked).toBe(true);
    expect(rowOf(r2, 'c').startOffset).toBe(240); // 紧跟锁定行，不被 a 推后
  });

  it('锁定行拦断消化区段：锚点之前的超时不会吃掉锚点之后的缓冲', () => {
    const mk = (aDur: number) => [
      seg({ id: 'a', duration: aDur }),
      seg({ id: 'lk', duration: 60, locked: true, actualStartOffset: 120, actualEndOffset: 180 }),
      seg({ id: 'buf', kind: 'buffer', duration: 300 }),
      seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 480 }),
    ];
    const r = computeSchedule(mk(400)); // a 超时延伸到锁定行附近，但不跨锚点消化
    expect(rowOf(r, 'lk').startOffset).toBe(120);
    expect(rowOf(r, 'buf').computedDuration).toBe(300); // 缓冲未被前序超时消耗
    expect(rowOf(r, 'f').startOffset).toBe(480);
    expect(r.conflicts).toHaveLength(0);
  });

  it('锁定锚点之后的区段仍按原规则消化固定点超时', () => {
    const r = computeSchedule([
      seg({ id: 'lk', duration: 60, locked: true, actualStartOffset: 0, actualEndOffset: 120 }),
      seg({ id: 'buf', kind: 'buffer', duration: 600 }),
      seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 480 }),
    ]);
    // 自然开始 720，超时 240，由锚点之后的缓冲单独消化
    expect(rowOf(r, 'buf').computedDuration).toBe(360);
    expect(rowOf(r, 'buf').compressedBy).toBe(240);
    expect(rowOf(r, 'f').startOffset).toBe(480);
    expect(r.conflicts).toHaveLength(0);
  });

  it('锁定行不参与压缩：消化能力统计不含锁定的可压缩环节', () => {
    const r = computeSchedule([
      seg({ id: 'lk', kind: 'compressible', duration: 600, minDuration: 60, locked: true, actualStartOffset: 0, actualEndOffset: 600 }),
      seg({ id: 'tail', duration: 60 }),
    ]);
    expect(rowOf(r, 'lk').computedDuration).toBe(600); // 锁多少就是多少
    expect(rowOf(r, 'tail').startOffset).toBe(600);
  });
});
