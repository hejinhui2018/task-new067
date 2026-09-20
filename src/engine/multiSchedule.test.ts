import { describe, expect, it } from 'vitest';
import { computeVenueSchedule } from './schedule';
import type { ScheduledRow } from './schedule';
import { computeShowSchedule } from './multiSchedule';
import { createDefaultShow } from '../store/defaultShow';
import type { RundownState, Segment, Venue } from '../types';

const seg = (s: Partial<Segment> & { id: string }): Segment => ({
  title: s.id,
  kind: 'normal',
  duration: 60,
  minDuration: 0,
  resources: [],
  ...s,
});

const venue = (id: string, segments: Segment[]): Venue => ({ id, name: id, segments });

const rowOf = (v: ReturnType<typeof computeVenueSchedule>, id: string): ScheduledRow => {
  const row = v.result.rows.find((x): x is ScheduledRow => x.kind === 'segment' && x.segment.id === id);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};

const MAIN = 'main';
const ROOM = 'interview-room';

const withMainDuration = (state: RundownState, id: string, duration: number): RundownState => ({
  ...state,
  venues: state.venues.map((v) =>
    v.id === MAIN
      ? { ...v, segments: v.segments.map((s) => (s.id === id ? { ...s, duration } : s)) }
      : v,
  ),
});

describe('双场地独立调整', () => {
  it('内置节目单：两条时间线各自排程，无冲突', () => {
    const show = computeShowSchedule(createDefaultShow());
    expect(show.venues).toHaveLength(2);
    const [main, room] = show.venues;
    expect(rowOf(main, 'live').startOffset).toBe(900);
    expect(main.result.endOffset).toBe(1800);
    expect(rowOf(room, 'ir-guest').startOffset).toBe(780); // 嘉宾专访 10:13 接上主舞台采访
    expect(room.result.endOffset).toBe(1500);
    expect(show.fixedConflictCount).toBe(0);
    expect(show.resourceConflicts).toHaveLength(0);
    expect(show.endOffset).toBe(1800); // 取各场地最晚
  });

  it('延长主舞台环节不改变访谈间的时间轴', () => {
    const base = computeShowSchedule(createDefaultShow());
    const extended = computeShowSchedule(withMainDuration(createDefaultShow(), 'comment', 600));
    const roomBefore = base.venues[1].result.rows.map((r) => [r.startOffset, r.endOffset]);
    const roomAfter = extended.venues[1].result.rows.map((r) => [r.startOffset, r.endOffset]);
    expect(roomAfter).toEqual(roomBefore);
    // 主舞台自身顺延
    expect(extended.venues[0].result.endOffset).toBe(base.venues[0].result.endOffset + 120);
  });
});

describe('固定点传播', () => {
  it('固定点只约束本场地：访谈间超时不会推到主舞台', () => {
    const state = createDefaultShow();
    // 给访谈间的嘉宾专访设固定点 10:13（其原本的自然开始时刻，不扰动流程），
    // 再把预热对谈延长 8:00 → 只能消化访谈间自己的缓冲与可压缩环节
    const modified: RundownState = {
      ...state,
      venues: state.venues.map((v) =>
        v.id === ROOM
          ? {
              ...v,
              segments: v.segments.map((s) =>
                s.id === 'ir-guest'
                  ? { ...s, kind: 'fixed' as const, fixedStartOffset: 780 }
                  : s.id === 'ir-warmup'
                    ? { ...s, duration: 720 }
                    : s,
              ),
            }
          : v,
      ),
    };
    const show = computeShowSchedule(modified);
    const [main, room] = show.venues;
    // 主舞台完全不动
    expect(rowOf(main, 'live').startOffset).toBe(900);
    expect(main.result.endOffset).toBe(1800);
    expect(main.result.adjustments).toHaveLength(0);
    // 访谈间：超时 8:00 由本场地缓冲 6:00 + 预热压缩 2:00 消化，专访固定点准点
    expect(rowOf(room, 'ir-buffer').computedDuration).toBe(0);
    expect(rowOf(room, 'ir-warmup').computedDuration).toBe(600);
    expect(rowOf(room, 'ir-guest').startOffset).toBe(780);
    expect(show.fixedConflictCount).toBe(0);
    expect(show.resourceConflicts).toHaveLength(0);
  });

  it('主舞台采访延长：固定点连线仍准点，冲突以资源形式传到访谈间', () => {
    const modified = withMainDuration(createDefaultShow(), 'interview', 480);
    const show = computeShowSchedule(modified);
    const main = show.venues[0];
    expect(rowOf(main, 'live').startOffset).toBe(900); // 固定点不动
    expect(rowOf(main, 'buffer').computedDuration).toBe(0); // 缓冲消化 2:00
    expect(rowOf(main, 'interview').computedDuration).toBe(480); // 采访实际 8:00
    // 采访占到 10:15，嘉宾-陈 与访谈间专访（10:13 起）撞车
    expect(show.resourceConflicts).toHaveLength(1);
    const c = show.resourceConflicts[0];
    expect(c.resource).toBe('嘉宾-陈');
    expect(c.startOffset).toBe(780);
    expect(c.endOffset).toBe(900);
    expect(c.usages.map((u) => u.segmentId).sort()).toEqual(['interview', 'ir-guest']);
  });
});

describe('可压缩区段', () => {
  it('压缩只发生在本场地同一区段内，另一场地的可压缩环节不受影响', () => {
    const modified = withMainDuration(createDefaultShow(), 'interview', 600);
    const show = computeShowSchedule(modified);
    const [main, room] = show.venues;
    // 主舞台：缓冲耗尽 + 新闻压到下限
    expect(rowOf(main, 'buffer').computedDuration).toBe(0);
    expect(rowOf(main, 'news').computedDuration).toBe(180);
    // 访谈间的可压缩环节完全不参与主舞台的消化
    expect(rowOf(room, 'ir-warmup').computedDuration).toBe(240);
    expect(rowOf(room, 'ir-guest').computedDuration).toBe(360);
    expect(room.result.adjustments).toHaveLength(0);
  });

  it('双场地各自的固定点分区互不影响', () => {
    const v1 = venue('v1', [
      seg({ id: 'a', duration: 300 }),
      seg({ id: 'f1', kind: 'fixed', duration: 60, fixedStartOffset: 300 }),
      seg({ id: 'b', kind: 'buffer', duration: 120 }),
      seg({ id: 'c', kind: 'compressible', duration: 300, minDuration: 60 }),
      seg({ id: 'f2', kind: 'fixed', duration: 60, fixedStartOffset: 480 }),
    ]);
    const v2 = venue('v2', [
      seg({ id: 'x', kind: 'compressible', duration: 300, minDuration: 120 }),
      seg({ id: 'g1', kind: 'fixed', duration: 60, fixedStartOffset: 60 }),
    ]);
    const s1 = computeVenueSchedule(v1, 0);
    const s2 = computeVenueSchedule(v2, 0);
    // v1：f2 前的超时由本区段 b+c 消化
    expect(rowOf(s1, 'b').computedDuration).toBe(0);
    expect(rowOf(s1, 'c').computedDuration).toBe(120);
    expect(rowOf(s1, 'f2').startOffset).toBe(480);
    // v2：x 压到下限 2:00 仍超时 1:00 → 报 v2 自己的固定点冲突，g1 不动
    expect(rowOf(s2, 'x').computedDuration).toBe(120);
    expect(s2.result.conflicts).toHaveLength(1);
    expect(s2.result.conflicts[0].fixedSegmentId).toBe('g1');
    expect(s2.result.conflicts[0].overBy).toBe(60);
    expect(rowOf(s2, 'g1').startOffset).toBe(60);
  });
});

describe('已执行前缀', () => {
  it('锁定线之前的环节被锁定，之后的正常', () => {
    const show = createDefaultShow();
    const main = show.venues.find((v) => v.id === MAIN)!;
    const vs = computeVenueSchedule(main, 600); // 已执行至 10:10
    expect([...vs.lockedIds].sort()).toEqual(['interview', 'news', 'opening']);
    expect(vs.lockedIds.has('buffer')).toBe(false); // 缓冲 10:13 才开始
  });

  it('已执行环节不被压缩消化；消化不了就报冲突而不是改写历史', () => {
    const show = createDefaultShow();
    const main = show.venues.find((v) => v.id === MAIN)!;
    // 已执行至 10:10：开场/新闻/采访锁定。采访实际播了 10 分钟（超时 4:00）
    const executedMain: Venue = {
      ...main,
      segments: main.segments.map((s) => (s.id === 'interview' ? { ...s, duration: 600 } : s)),
    };
    const vs = computeVenueSchedule(executedMain, 600);
    // 新闻、采访已播出，不能被压缩；只有未锁定的缓冲（2:00）可消化
    expect(rowOf(vs, 'news').computedDuration).toBe(300);
    expect(rowOf(vs, 'interview').computedDuration).toBe(600);
    expect(rowOf(vs, 'buffer').computedDuration).toBe(0);
    // 超时 4:00 只消化掉 2:00 → 无解：报冲突 2:00，固定点仍准点
    expect(vs.result.conflicts).toHaveLength(1);
    expect(vs.result.conflicts[0].overBy).toBe(120);
    expect(vs.result.conflicts[0].absorbed).toBe(120);
    expect(rowOf(vs, 'live').startOffset).toBe(900);
  });

  it('未锁定时同样的超时可以消化——对照组', () => {
    const show = createDefaultShow();
    const main = show.venues.find((v) => v.id === MAIN)!;
    const extendedMain: Venue = {
      ...main,
      segments: main.segments.map((s) => (s.id === 'interview' ? { ...s, duration: 600 } : s)),
    };
    const vs = computeVenueSchedule(extendedMain, 0);
    expect(vs.result.conflicts).toHaveLength(0);
    expect(rowOf(vs, 'news').computedDuration).toBe(180); // 未锁定：正常被压缩
  });

  it('锁定集合迭代到不动点：锁定后已执行环节的开始时刻保持稳定', () => {
    const show = createDefaultShow();
    const main = show.venues.find((v) => v.id === MAIN)!;
    const once = computeVenueSchedule(main, 600);
    const twice = computeVenueSchedule(main, 600);
    expect([...once.lockedIds].sort()).toEqual([...twice.lockedIds].sort());
    expect(once.result.rows.map((r) => r.startOffset)).toEqual(
      twice.result.rows.map((r) => r.startOffset),
    );
  });
});

describe('无解场景', () => {
  it('整档聚合如实上报固定点无解冲突，不悄悄后移', () => {
    const state = createDefaultShow();
    const broken: RundownState = {
      ...state,
      venues: state.venues.map((v) =>
        v.id === MAIN
          ? { ...v, segments: v.segments.map((s) => (s.id === 'opening' ? { ...s, duration: 1200 } : s)) }
          : v,
      ),
    };
    const show = computeShowSchedule(broken);
    expect(show.fixedConflictCount).toBe(1);
    const main = show.venues[0];
    expect(rowOf(main, 'live').startOffset).toBe(900); // 固定点绝不被越过
    expect(main.result.conflicts[0].overBy).toBeGreaterThan(0);
  });
});
