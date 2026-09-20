import { describe, expect, it } from 'vitest';
import { computeVenueSchedule } from './schedule';
import type { VenueSchedule } from './schedule';
import { computeShowSchedule } from './multiSchedule';
import { applyOps, detectResourceConflicts, lastLockedIndex, suggestResolutions } from './resources';
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

const stateOf = (venues: Venue[], executedUntil: Record<string, number> = {}): RundownState => ({
  showName: '测试',
  showStartSeconds: 10 * 3600,
  slotDuration: 30 * 60,
  venues,
  executedUntil,
});

const schedulesOf = (state: RundownState): VenueSchedule[] =>
  state.venues.map((v) => computeVenueSchedule(v, state.executedUntil[v.id] ?? 0));

/** 主舞台采访延长到 8:00 的整档状态（嘉宾-陈 与访谈间专访撞车） */
const extendedShow = (): RundownState => {
  const state = createDefaultShow();
  return {
    ...state,
    venues: state.venues.map((v) =>
      v.id === 'main'
        ? { ...v, segments: v.segments.map((s) => (s.id === 'interview' ? { ...s, duration: 480 } : s)) }
        : v,
    ),
  };
};

describe('跨场地资源碰撞检测', () => {
  it('同一资源在不同场地时间重叠 → 报出冲突区间与涉及环节', () => {
    const vs = schedulesOf(extendedShow());
    const conflicts = detectResourceConflicts(vs);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.resource).toBe('嘉宾-陈');
    expect(c.startOffset).toBe(780); // 专访 10:13 开始
    expect(c.endOffset).toBe(900); // 采访 10:15 才结束
    expect(c.usages).toHaveLength(2);
    expect(c.usages[0]).toMatchObject({ venueId: 'main', segmentId: 'interview', startOffset: 420, endOffset: 900 });
    expect(c.usages[1]).toMatchObject({ venueId: 'interview-room', segmentId: 'ir-guest', startOffset: 780, endOffset: 1140 });
  });

  it('首尾相接（一个结束另一个开始）不算冲突', () => {
    const state = stateOf([
      venue('v1', [seg({ id: 'a', duration: 300, resources: ['R'] })]),
      venue('v2', [seg({ id: 'pad', duration: 300 }), seg({ id: 'b', duration: 300, resources: ['R'] })]),
    ]);
    expect(detectResourceConflicts(schedulesOf(state))).toHaveLength(0);
  });

  it('同一场地内的重叠属于固定点冲突，不重复报资源冲突', () => {
    const state = stateOf([
      venue('v1', [
        seg({ id: 'a', duration: 300, resources: ['R'] }),
        seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 120, resources: ['R'] }),
      ]),
      venue('v2', [seg({ id: 'x', duration: 300 })]),
    ]);
    const vs = schedulesOf(state);
    expect(vs[0].result.conflicts).toHaveLength(1); // 固定点冲突仍在
    expect(detectResourceConflicts(vs)).toHaveLength(0); // 资源冲突不报
  });

  it('传递重叠聚为一簇：A 撞 B、B 撞 C 属于同一冲突', () => {
    const state = stateOf([
      venue('v1', [
        seg({ id: 'a', duration: 100, resources: ['R'] }),
        seg({ id: 'gap', duration: 20 }),
        seg({ id: 'c', duration: 80, resources: ['R'] }),
      ]),
      venue('v2', [
        seg({ id: 'pad', duration: 50 }),
        seg({ id: 'b', duration: 100, resources: ['R'] }),
      ]),
    ]);
    const conflicts = detectResourceConflicts(schedulesOf(state));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].usages.map((u) => u.segmentId)).toEqual(['a', 'b', 'c']);
    expect(conflicts[0].startOffset).toBe(50);
    expect(conflicts[0].endOffset).toBe(150);
  });
});

describe('可行调整建议', () => {
  it('为嘉宾-陈冲突生成缩短/推迟建议，换场地方案被模拟过滤', () => {
    const state = extendedShow();
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    const suggestions = suggestResolutions(state, vs, conflict);
    const ids = suggestions.map((s) => s.id);

    // 缩短采访、推迟专访 —— 两条可行
    expect(ids).toContain('shorten-interview');
    expect(ids).toContain('delay-ir-guest');
    // 专访移到主舞台会撞上观众互动的 主持人B（10:13–10:16）→ 被模拟过滤
    expect(ids).not.toContain('move-second-ir-guest');
    // 采访移到访谈间会撞上连线的 主持人A（10:15–10:20）→ 被模拟过滤
    expect(ids).not.toContain('move-first-interview');

    // 每条建议应用后：资源冲突全部消除，且不新增固定点冲突
    for (const s of suggestions) {
      const next = applyOps(state, s.ops);
      const show = computeShowSchedule(next);
      expect(show.resourceConflicts).toHaveLength(0);
      expect(show.fixedConflictCount).toBe(0);
    }
  });

  it('缩短建议：采访 8:00 → 6:00，10:13 前让出嘉宾', () => {
    const state = extendedShow();
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    const s = suggestResolutions(state, vs, conflict).find((x) => x.id === 'shorten-interview')!;
    expect(s.ops).toEqual([
      { type: 'set-duration', venueId: 'main', segmentId: 'interview', duration: 360 },
    ]);
    const next = applyOps(state, s.ops);
    const main = computeVenueSchedule(next.venues[0], 0);
    const interview = main.result.rows.find(
      (r): r is Extract<typeof r, { kind: 'segment' }> => r.kind === 'segment' && r.segment.id === 'interview',
    )!;
    expect(interview.endOffset).toBe(780);
  });

  it('推迟建议：在专访前插入垫片，专访移到 10:15 开始', () => {
    const state = extendedShow();
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    const s = suggestResolutions(state, vs, conflict).find((x) => x.id === 'delay-ir-guest')!;
    expect(s.ops[0].type).toBe('insert');
    const next = applyOps(state, s.ops);
    const room = computeVenueSchedule(next.venues[1], 0);
    const guest = room.result.rows.find(
      (r): r is Extract<typeof r, { kind: 'segment' }> => r.kind === 'segment' && r.segment.id === 'ir-guest',
    )!;
    expect(guest.startOffset).toBe(900);
    // 垫片只影响本场地，主舞台不变
    expect(computeVenueSchedule(next.venues[0], 0).result.endOffset).toBe(1800);
  });

  it('后占用方被完全包含时，推迟量按先占用方结束时刻计算', () => {
    // b 完全落在 a 的区间内：重叠 1:40，但要推迟 6:40 才能真正让出资源
    const state = stateOf([
      venue('v1', [seg({ id: 'a', duration: 600, resources: ['R'] })]),
      venue('v2', [seg({ id: 'pad', duration: 200 }), seg({ id: 'b', duration: 100, resources: ['R'] })]),
    ]);
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    expect(conflict.endOffset - conflict.startOffset).toBe(100);
    const suggestions = suggestResolutions(state, vs, conflict);
    const delay = suggestions.find((s) => s.id === 'delay-b');
    expect(delay).toBeDefined();
    const next = applyOps(state, delay!.ops);
    const show = computeShowSchedule(next);
    expect(show.resourceConflicts).toHaveLength(0);
    // b 被推迟到 a 结束之后（10:10）
    const room = show.venues[1];
    const b = room.result.rows.find(
      (r): r is Extract<typeof r, { kind: 'segment' }> => r.kind === 'segment' && r.segment.id === 'b',
    )!;
    expect(b.startOffset).toBe(600);
  });

  it('会被固定点反弹回来的推迟方案不会出现（模拟过滤）', () => {
    // v2 的固定点 10:10 紧随其后：在 b 前插垫片只会被消化掉，b 挪不动
    const state = stateOf([
      venue('v1', [seg({ id: 'a', duration: 600, resources: ['R'] })]),
      venue('v2', [
        seg({ id: 'x', duration: 300 }),
        seg({ id: 'b', duration: 300, resources: ['R'] }),
        seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 600 }),
      ]),
    ]);
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    expect(conflict.resource).toBe('R');
    const ids = suggestResolutions(state, vs, conflict).map((s) => s.id);
    expect(ids).toContain('shorten-a'); // 缩短 a 可行
    expect(ids).toContain('move-second-b'); // b 换到 v1 可行
    expect(ids).not.toContain('delay-b'); // 推迟会被固定点前的消化规则吃掉 → 不提供
    expect(ids).not.toContain('move-first-a'); // a 移到 v2 会撞固定点 → 不提供
  });
});

describe('无解场景', () => {
  it('冲突双方都已被执行锁定 → 建议为空，冲突如实保留', () => {
    const state = extendedShow();
    const locked: RundownState = {
      ...state,
      executedUntil: { main: 900, 'interview-room': 900 },
    };
    const vs = schedulesOf(locked);
    const conflicts = detectResourceConflicts(vs);
    expect(conflicts).toHaveLength(1); // 冲突依然存在
    expect(suggestResolutions(locked, vs, conflicts[0])).toHaveLength(0);
    // 整档聚合同样：有冲突、无建议
    const show = computeShowSchedule(locked);
    expect(show.resourceConflicts).toHaveLength(1);
    expect(show.resourceConflicts[0].suggestions).toHaveLength(0);
  });

  it('压缩到下限也不够时不提供“缩短”建议', () => {
    // a 是可压缩环节，压到下限也只能让出 1:00，但重叠有 4:00
    const state = stateOf([
      venue('v1', [seg({ id: 'a', kind: 'compressible', duration: 420, minDuration: 360, resources: ['R'] })]),
      venue('v2', [
        seg({ id: 'pad', duration: 180 }),
        seg({ id: 'b', duration: 300, resources: ['R'] }),
        seg({ id: 'f', kind: 'fixed', duration: 60, fixedStartOffset: 780 }),
      ]),
    ]);
    const vs = schedulesOf(state);
    const conflict = detectResourceConflicts(vs)[0];
    expect(conflict.endOffset - conflict.startOffset).toBe(240);
    const ids = suggestResolutions(state, vs, conflict).map((s) => s.id);
    expect(ids).not.toContain('shorten-a'); // 下限不够，不提供
  });
});

describe('applyOps 与锁定下标', () => {
  it('set-duration / insert / move 都是纯变换', () => {
    const state = createDefaultShow();
    const after = applyOps(state, [
      { type: 'set-duration', venueId: 'main', segmentId: 'news', duration: 400 },
      {
        type: 'insert',
        venueId: 'interview-room',
        index: 0,
        segment: seg({ id: 'new', title: '新', duration: 30 }),
      },
      { type: 'move', segmentId: 'comment', fromVenueId: 'main', toVenueId: 'interview-room', index: 9 },
    ]);
    // 原状态不变
    expect(state.venues[0].segments.find((s) => s.id === 'news')!.duration).toBe(300);
    expect(state.venues[0].segments).toHaveLength(7);
    // 新状态生效
    expect(after.venues[0].segments.find((s) => s.id === 'news')!.duration).toBe(400);
    expect(after.venues[1].segments[0].id).toBe('new');
    expect(after.venues[1].segments.at(-1)!.id).toBe('comment');
    expect(after.venues[0].segments.find((s) => s.id === 'comment')).toBeUndefined();
  });

  it('lastLockedIndex 返回最后一个已执行环节的下标', () => {
    const v = venue('v1', [seg({ id: 'a' }), seg({ id: 'b' }), seg({ id: 'c' })]);
    expect(lastLockedIndex(v, new Set())).toBe(-1);
    expect(lastLockedIndex(v, new Set(['a', 'b']))).toBe(1);
    expect(lastLockedIndex(v, new Set(['c']))).toBe(2);
  });
});
