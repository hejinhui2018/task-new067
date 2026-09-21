import { describe, expect, it } from 'vitest';
import { detectResourceConflicts } from './resources';
import { computeShowSchedule } from './showSchedule';
import { createDualVenueShow } from '../store/defaultShow';
import { createInitialHistory, rundownReducer } from '../store/reducer';
import type { RundownState, Segment, VenueId } from '../types';

const seg = (s: Partial<Segment> & { id: string; venue?: VenueId }): Segment => ({
  title: s.id,
  kind: 'normal',
  duration: 300,
  minDuration: 0,
  venue: 'A',
  resourceIds: [],
  ...s,
});

const res = (id: string, name = id) => ({ id, name, kind: 'person' as const });

function show(segments: Segment[], resourceIds: string[]): RundownState {
  return {
    showName: 't',
    showStartSeconds: 10 * 3600,
    slotDuration: 30 * 60,
    venues: [
      { id: 'A', name: '主舞台' },
      { id: 'B', name: '访谈间' },
    ],
    resources: resourceIds.map((id) => res(id)),
    segments,
  };
}

describe('双场地基线', () => {
  it('内置双场地节目单初始无资源碰撞、无固定点冲突', () => {
    const s = computeShowSchedule(createDualVenueShow());
    expect(s.resourceConflicts).toHaveLength(0);
    expect(s.fixedConflicts).toHaveLength(0);
    expect(s.byVenue.get('A')!.schedule.endOffset).toBe(1800);
    expect(s.byVenue.get('B')!.schedule.endOffset).toBe(1620);
    // 两个固定点各自准点
    const aLive = s.byVenue.get('A')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'live',
    )!;
    expect(aLive.startOffset).toBe(900);
    const bLive = s.byVenue.get('B')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'b-live',
    )!;
    expect(bLive.startOffset).toBe(1260);
  });
});

describe('跨场地资源碰撞', () => {
  it('主舞台采访临时延长：本场地靠消化保住固定点，同时报出与访谈间的资源碰撞区间', () => {
    const state = createDualVenueShow();
    state.segments = state.segments.map((s) =>
      s.id === 'interview' ? { ...s, duration: s.duration + 360 } : s,
    );
    const full = computeShowSchedule(state);

    // 主舞台固定点 10:15 纹丝不动，超时由缓冲+新闻+采访自身消化
    const aLive = full.byVenue.get('A')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'live',
    )!;
    expect(aLive.startOffset).toBe(900);
    expect(full.fixedConflicts).toHaveLength(0);

    // 采访被压到 300-900，与访谈间联合对谈 780-1200 在 780-900 相撞
    const conflicts = full.resourceConflicts;
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.startOffset).toBe(780);
    expect(c.endOffset).toBe(900);
    expect(c.duration).toBe(120);
    expect(c.resourceIds.sort()).toEqual(['guest-lin', 'host']);
    const ids = c.parties.map((p) => p.segmentId).sort();
    expect(ids).toEqual(['b-talk2', 'interview']);
    expect(c.parties.map((p) => p.venueId).sort()).toEqual(['A', 'B']);
    expect(c.unsolvable).toBe(false);
  });

  it('碰撞合并：同一对环节同时占用主持人与嘉宾只报一条', () => {
    const state = createDualVenueShow();
    state.segments = state.segments.map((s) =>
      s.id === 'interview' ? { ...s, duration: s.duration + 360 } : s,
    );
    expect(detectResourceConflicts(state)).toHaveLength(1);
  });

  it('不共享资源的时间重叠不构成碰撞', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 600, resourceIds: ['van'] }),
        seg({ id: 'b1', venue: 'B', duration: 600, resourceIds: ['host'] }),
      ],
      ['van', 'host'],
    );
    expect(detectResourceConflicts(state)).toHaveLength(0);
  });

  it('同一资源被三个环节重叠占用时逐对报告', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 600, resourceIds: ['host'] }),
        seg({ id: 'b1', venue: 'B', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'b2', venue: 'B', duration: 300, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    // a1 0-600 与 b1 0-300、b2 300-600 均重叠（b1/b2 首尾相接不重叠）
    expect(detectResourceConflicts(state).map((c) => c.id).sort()).toEqual(['a1|b1', 'a1|b2']);
  });
});

describe('固定点跨场地传播隔离', () => {
  it('访谈间超时消化不下只报访谈间固定点冲突，主舞台时间线不受影响', () => {
    const state = createDualVenueShow();
    // b-talk2 是固定点前的常规环节（不可压缩），延长 10 分钟 → B 固定点 1260 必被突破
    state.segments = state.segments.map((s) =>
      s.id === 'b-talk2' ? { ...s, duration: s.duration + 600 } : s,
    );
    const full = computeShowSchedule(state);
    expect(full.fixedConflicts).toHaveLength(1);
    expect(full.fixedConflicts[0].fixedSegmentId).toBe('b-live');
    // 自然开始 1800，可消化 = b-buf 180 + b-talk1 可压（480-300）180 = 360，仍超 180
    expect(full.fixedConflicts[0].overBy).toBe(180);
    // 固定点不移动
    const bLive = full.byVenue.get('B')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'b-live',
    )!;
    expect(bLive.startOffset).toBe(1260);
    // 主舞台完全不受影响
    const aLive = full.byVenue.get('A')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'live',
    )!;
    expect(aLive.startOffset).toBe(900);
    expect(full.byVenue.get('A')!.schedule.endOffset).toBe(1800);
  });

  it('可压缩+缓冲充足时访谈间超时就地消化，不产生任何冲突', () => {
    const state = createDualVenueShow();
    // b-talk1 可压缩（下限 300），延长 10 分钟：b-buf 180 + 自身可压 780，足够吸收
    state.segments = state.segments.map((s) =>
      s.id === 'b-talk1' ? { ...s, duration: s.duration + 600 } : s,
    );
    const full = computeShowSchedule(state);
    expect(full.fixedConflicts).toHaveLength(0);
    const bLive = full.byVenue.get('B')!.schedule.rows.find(
      (r) => r.kind === 'segment' && r.segment.id === 'b-live',
    )!;
    expect(bLive.startOffset).toBe(1260);
  });
});

describe('可行调整建议（可压缩区段/缓冲）', () => {
  it('缩短先开始的一方：给出精确缩短动作，模拟确认后可行', () => {
    // A a1 0-900 占 host；B b0 600 后 b1 600-? 占 host（600-900 重叠 300）
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 900, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', duration: 600, resourceIds: [] }),
        seg({ id: 'b1', venue: 'B', duration: 300, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const [c] = detectResourceConflicts(state);
    const shorten = c.advices.find((a) => a.kind === 'shorten-row')!;
    expect(shorten.feasible).toBe(true);
    expect(shorten.action).toMatchObject({ type: 'UPDATE_DURATION', id: 'a1', duration: 600 });
  });

  it('提前：压缩本场地前序缓冲把先开始一方整体前移（不动固定点、不动另一场地）', () => {
    // A：缓冲 600 + a1(host,600) → a1 600-1200；B：b0 600 + b1(host,300) → b1 600-900
    // a1 要结束 ≤ 600，前序缓冲必须全部清零（600），a1 前移到 0-600，与 b1 首尾相接
    const state = show(
      [
        seg({ id: 'abuf', venue: 'A', kind: 'buffer', duration: 600, resourceIds: [] }),
        seg({ id: 'a1', venue: 'A', duration: 600, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', duration: 600, resourceIds: [] }),
        seg({ id: 'b1', venue: 'B', duration: 300, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const [c] = detectResourceConflicts(state);
    const advance = c.advices.find((a) => a.id === 'advance-a')!;
    expect(advance.feasible).toBe(true);
    expect(advance.action?.type).toBe('BATCH');
    const batch = advance.action!.type === 'BATCH' ? advance.action.actions : [];
    expect(batch).toEqual([{ type: 'UPDATE_DURATION', id: 'abuf', duration: 0 }]);

    // 真正执行建议动作后碰撞消失
    const applied = batch.reduce((segments, ac) => {
      if (ac.type === 'UPDATE_DURATION') {
        return segments.map((s) => (s.id === ac.id ? { ...s, duration: ac.duration } : s));
      }
      return segments;
    }, state.segments);
    expect(detectResourceConflicts({ ...state, segments: applied })).toHaveLength(0);
  });

  it('顺延：撑大后开始一方之前的缓冲，且撞上后续固定点时被模拟判为不可行', () => {
    // 延长主舞台采访后，顺延访谈间联合对谈到 15:00 会与主舞台评论（host 1200-1680）相撞 → 否决
    const state = createDualVenueShow();
    state.segments = state.segments.map((s) =>
      s.id === 'interview' ? { ...s, duration: s.duration + 360 } : s,
    );
    const [c] = detectResourceConflicts(state);
    const delay = c.advices.find((a) => a.kind === 'delay-row')!;
    expect(delay.feasible).toBe(false);
    expect(delay.action).toBeNull();
  });

  it('尾部无固定点时顺延可行：插入/撑大缓冲即消除碰撞', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 360, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', kind: 'buffer', duration: 300, resourceIds: [] }),
        seg({ id: 'b1', venue: 'B', duration: 120, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    // a1 0-360，b1 300-420 重叠 300-360；b0 缓冲撑大 60 → b1 360-480
    const [c] = detectResourceConflicts(state);
    const delay = c.advices.find((a) => a.kind === 'delay-row')!;
    expect(delay.feasible).toBe(true);
    expect(delay.action).toMatchObject({ type: 'BATCH' });
  });

  it('互换场地作为候选并经模拟裁决', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 600, resourceIds: ['host'] }),
        seg({ id: 'b1', venue: 'B', duration: 600, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const [c] = detectResourceConflicts(state);
    const swap = c.advices.find((a) => a.kind === 'swap-venue')!;
    // 两个环节完全同构，互换后仍重叠 → 模拟否决，避免给出假希望
    expect(swap.feasible).toBe(false);
  });
});

describe('无解场景', () => {
  it('固定点被前后资源占用四面围死：四个方向移动固定点都引发新碰撞或突破固定点 → 明确无解', () => {
    // 两场地结构相同：host 常规铺满 [0,600) 与 [900,1500)，中间 600-900 是 host 固定点
    // （同场地首尾相接不冲突；跨场地的常规墙让中央固定点无处可移）
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'a2', venue: 'A', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'fA', venue: 'A', kind: 'fixed', duration: 300, fixedStartOffset: 600, resourceIds: ['host'] }),
        seg({ id: 'a3', venue: 'A', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'a4', venue: 'A', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'b1', venue: 'B', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'b2', venue: 'B', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'fB', venue: 'B', kind: 'fixed', duration: 300, fixedStartOffset: 600, resourceIds: ['host'] }),
        seg({ id: 'b3', venue: 'B', duration: 300, resourceIds: ['host'] }),
        seg({ id: 'b4', venue: 'B', duration: 300, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const central = detectResourceConflicts(state).find((c) => c.id === 'fA|fB');
    expect(central).toBeDefined();
    const c = central!;
    expect(c.unsolvable).toBe(true);
    expect(c.unsolvableReason).toContain('固定开播点');
    for (const a of c.advices) {
      expect(a.feasible).toBe(false);
      expect(a.action).toBeNull();
    }
    // 四个移动方向全部被模拟否决
    for (const id of ['move-fixed-a-later', 'move-fixed-a-earlier', 'move-fixed-b-earlier', 'move-fixed-b-later']) {
      const advice = c.advices.find((a) => a.id === id);
      expect(advice).toBeDefined();
      expect(advice!.feasible).toBe(false);
    }
  });

  it('两个已执行锁定行相撞：常规调整全部不可行，只留解锁前缀一条路', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 600, resourceIds: ['host'], locked: true, actualStartOffset: 0, actualEndOffset: 600 }),
        seg({ id: 'b1', venue: 'B', duration: 600, resourceIds: ['host'], locked: true, actualStartOffset: 0, actualEndOffset: 600 }),
      ],
      ['host'],
    );
    const [c] = detectResourceConflicts(state);
    expect(c.parties.every((p) => p.locked)).toBe(true);
    const normal = c.advices.filter((a) => a.kind !== 'unlock-row');
    expect(normal.every((a) => !a.feasible)).toBe(true);
    const unlock = c.advices.filter((a) => a.kind === 'unlock-row');
    expect(unlock).toHaveLength(2);
    expect(unlock.every((a) => a.feasible && a.action?.type === 'UNLOCK_VENUE')).toBe(true);
  });
});

describe('建议动作端到端（经真实 reducer 执行后碰撞消失）', () => {
  /** 通过真实 reducer 应用建议（BATCH/单动作），返回新的 present */
  const applyAdvice = (state: RundownState, action: NonNullable<ReturnType<typeof detectResourceConflicts>[number]['advices'][number]['action']>) =>
    rundownReducer(createInitialHistory(state), action).present;

  it('缩短建议：reducer 执行后该碰撞消失且固定点未突破', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 900, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', duration: 600 }),
        seg({ id: 'b1', venue: 'B', duration: 300, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const shorten = detectResourceConflicts(state)[0].advices.find((a) => a.kind === 'shorten-row')!;
    expect(shorten.feasible).toBe(true);
    const next = applyAdvice(state, shorten.action!);
    expect(detectResourceConflicts(next)).toHaveLength(0);
    expect(computeShowSchedule(next).fixedConflicts).toHaveLength(0);
  });

  it('顺延建议（撑大既有缓冲）：reducer 执行后碰撞消失', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 360, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', kind: 'buffer', duration: 300 }),
        seg({ id: 'b1', venue: 'B', duration: 120, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const delay = detectResourceConflicts(state)[0].advices.find((a) => a.kind === 'delay-row')!;
    expect(delay.feasible).toBe(true);
    const next = applyAdvice(state, delay.action!);
    expect(detectResourceConflicts(next)).toHaveLength(0);
    // 缓冲被撑大 60 秒
    expect(next.segments.find((s) => s.id === 'b0')!.duration).toBe(360);
  });

  it('顺延建议（无缓冲时插入新缓冲段）：reducer 执行后碰撞消失', () => {
    const state = show(
      [
        seg({ id: 'a1', venue: 'A', duration: 360, resourceIds: ['host'] }),
        seg({ id: 'b1', venue: 'B', duration: 240, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    const delay = detectResourceConflicts(state)[0].advices.find((a) => a.kind === 'delay-row')!;
    expect(delay.feasible).toBe(true);
    const next = applyAdvice(state, delay.action!);
    expect(detectResourceConflicts(next)).toHaveLength(0);
    // 新插入了一个属于 B 的缓冲段
    const buffers = next.segments.filter((s) => s.venue === 'B' && s.kind === 'buffer');
    expect(buffers).toHaveLength(1);
  });

  it('移动固定点建议：reducer 执行后碰撞消失，新时刻生效', () => {
    const state = show(
      [
        seg({ id: 'fA', venue: 'A', kind: 'fixed', duration: 300, fixedStartOffset: 0, resourceIds: ['host'] }),
        seg({ id: 'b0', venue: 'B', duration: 600 }),
        seg({ id: 'fB', venue: 'B', kind: 'fixed', duration: 300, fixedStartOffset: 600, resourceIds: ['host'] }),
      ],
      ['host'],
    );
    // fA 0-300 与 fB 600-900 不重叠；让 fA 延长到 900 触发重叠后，后移 fB 应可行
    const extended = {
      ...state,
      segments: state.segments.map((s) => (s.id === 'fA' ? { ...s, duration: 900 } : s)),
    };
    const move = detectResourceConflicts(extended)[0].advices.find((a) => a.id === 'move-fixed-b-later')!;
    expect(move.feasible).toBe(true);
    const next = applyAdvice(extended, move.action!);
    expect(detectResourceConflicts(next)).toHaveLength(0);
  });
});
