import type { RundownState, Segment, SegmentKind, SharedResource, VenueId } from '../types';
import { computeSchedule } from './schedule';
import type { Conflict, ScheduledRow } from './schedule';
import { fmtDur } from './time';
import type { RundownAction } from '../store/reducer';

/** 常规环节缩短的最小步长（与 reducer.MIN_SEGMENT_DURATION 保持一致） */
const MIN_SEGMENT_DURATION = 30;

const venueOf = (s: Segment): VenueId => s.venue ?? 'A';
const segmentsOfVenue = (segments: Segment[], venue: VenueId): Segment[] =>
  segments.filter((s) => venueOf(s) === venue);

/** 冲突中的一方（某场地的一个环节实例） */
export interface ConflictParty {
  segmentId: string;
  venueId: VenueId;
  title: string;
  kind: SegmentKind;
  startOffset: number;
  endOffset: number;
  locked: boolean;
}

export type AdviceKind =
  | 'shorten-row'
  | 'advance-row'
  | 'delay-row'
  | 'move-fixed'
  | 'swap-venue'
  | 'unlock-row';

export type AdviceTone = 'compress' | 'delay' | 'move' | 'fix' | 'unlock';

/** 一条可行（或经模拟确认不可行）的调整建议，可一键采用 */
export interface AdjustmentAdvice {
  id: string;
  kind: AdviceKind;
  tone: AdviceTone;
  /** 一句话建议 */
  summary: string;
  /** 依据与影响说明 */
  detail: string;
  /** 一键采用的动作；不可行为 null */
  action: RundownAction | null;
  feasible: boolean;
  /** feasible=false 时的阻碍原因 */
  blockedReason?: string;
}

/** 跨场地（或同场地双锁定）的资源碰撞 */
export interface ResourceConflict {
  id: string;
  /** 碰撞涉及的全部资源（同一对环节常同时占用主持人+嘉宾） */
  resourceIds: string[];
  resourceName: string;
  /** 碰撞区间（距开播秒数） */
  startOffset: number;
  endOffset: number;
  duration: number;
  parties: [ConflictParty, ConflictParty];
  advices: AdjustmentAdvice[];
  /** 所有候选建议均不可行 */
  unsolvable: boolean;
  unsolvableReason?: string;
}

interface VenueRows {
  venueId: VenueId;
  rows: ScheduledRow[];
}

const partyOf = (venueId: VenueId, row: ScheduledRow): ConflictParty => ({
  segmentId: row.segment.id,
  venueId,
  title: row.segment.title,
  kind: row.segment.kind,
  startOffset: row.startOffset,
  endOffset: row.endOffset,
  locked: row.locked,
});

const overlaps = (a: { startOffset: number; endOffset: number }, b: { startOffset: number; endOffset: number }) =>
  a.startOffset < b.endOffset && b.startOffset < a.endOffset;

/** 行的消化下限：缓冲 0、可压缩取 minDuration，其余不可压缩 */
const floorOf = (seg: Segment): number => {
  if (seg.kind === 'buffer') return 0;
  if (seg.kind === 'compressible') return seg.minDuration;
  return seg.duration;
};

/** 计划口径的可提前量（动作直接改计划时长，可达各环节计划下限） */
function reliefBeforePlanned(rows: ScheduledRow[], index: number): number {
  let relief = 0;
  for (let i = index - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.locked || r.segment.kind === 'fixed') break;
    relief += r.segment.duration - floorOf(r.segment);
  }
  return relief;
}

/** 某行之后（下一锚点之前）可用于「顺延」的消化能力 + 既有空档 */
function slackAfter(rows: ScheduledRow[], index: number): number {
  // 找到下一锚点（固定/锁定）与本段最后一个可移动行
  let anchorStart: number | null = null;
  let lastMovableEnd = rows[index].endOffset;
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.locked || r.segment.kind === 'fixed') {
      anchorStart = r.startOffset;
      break;
    }
    lastMovableEnd = r.endOffset;
  }
  let relief = 0;
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.locked || r.segment.kind === 'fixed') break;
    relief += r.computedDuration - floorOf(r.segment);
  }
  if (anchorStart === null) return Infinity; // 后面没有固定点：尾部顺延不受限
  return Math.max(0, anchorStart - lastMovableEnd) + relief;
}

/** 从 state 推导各场地已排程行（保持环节顺序） */
export function venueRowsOf(state: Pick<RundownState, 'segments' | 'venues'>): VenueRows[] {
  const venues = state.venues ?? [{ id: 'A' as VenueId, name: '主舞台' }];
  return venues.map((v) => ({
    venueId: v.id,
    rows: computeSchedule(segmentsOfVenue(state.segments, v.id)).rows.filter(
      (r): r is ScheduledRow => r.kind === 'segment',
    ),
  }));
}

interface Simulation {
  /** 当前时间重叠且共享至少一种资源的环节对 */
  pairKeys: Set<string>;
  fixedOverBy: number;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function simulate(segments: Segment[], resources: SharedResource[]): Simulation {
  const venues: VenueId[] = [...new Set(segments.map(venueOf))];
  if (!venues.includes('A')) venues.push('A');
  const rowsByVenue = new Map<VenueId, ScheduledRow[]>();
  const fixedOverBy = venues.reduce((sum, v) => {
    const rows = computeSchedule(segmentsOfVenue(segments, v));
    rowsByVenue.set(v, rows.rows.filter((r): r is ScheduledRow => r.kind === 'segment'));
    return sum + rows.conflicts.reduce((s, c: Conflict) => s + c.overBy, 0);
  }, 0);

  const pairKeys = new Set<string>();
  const resourceSet = new Set(resources.map((r) => r.id));
  const all: ScheduledRow[] = [...rowsByVenue.values()].flat();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const x = all[i];
      const y = all[j];
      if (!overlaps(x, y)) continue;
      const shared = [...(x.segment.resourceIds ?? [])].some(
        (rid) => resourceSet.has(rid) && (y.segment.resourceIds ?? []).includes(rid),
      );
      if (shared) pairKeys.add(pairKey(x.segment.id, y.segment.id));
    }
  }
  return { pairKeys, fixedOverBy };
}

/**
 * 构造「提前」动作：在目标行之前、上一锚点（固定/锁定）之后的区段内，
 * 按先缓冲、后可压缩的顺序压缩，余量按实际排程（computedDuration）计算，
 * 因此已经为前一个固定点压过的环节不会被重复计入。
 */
function advanceActions(
  rows: ScheduledRow[],
  targetIndex: number,
  need: number,
): RundownAction[] {
  const actions: RundownAction[] = [];
  let remaining = need;
  const zone: ScheduledRow[] = [];
  for (let i = targetIndex - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.locked || r.segment.kind === 'fixed') break;
    zone.unshift(r);
  }
  const take = (kind: Segment['kind']) => {
    for (const r of zone) {
      if (remaining <= 0) break;
      if (r.segment.kind !== kind) continue;
      // 动作改的是计划时长，下限按计划可压量计；最终能否真提前由「变换后重排」模拟裁决
      const cap = r.segment.duration - floorOf(r.segment);
      if (cap <= 0) continue;
      const cut = Math.min(cap, remaining);
      actions.push({ type: 'UPDATE_DURATION', id: r.segment.id, duration: r.segment.duration - cut });
      remaining -= cut;
    }
  };
  take('buffer');
  take('compressible');
  return actions;
}

/**
 * 构造「顺延」动作：撑大目标行之前最近的缓冲；没有缓冲就新插一个。
 * 插入位置按全量 segments 的索引计算，保证 INSERT_AT 落在目标场地正确位置。
 */
function delayActions(
  state: RundownState,
  rows: ScheduledRow[],
  targetIndex: number,
  venueId: VenueId,
  need: number,
  newId: string,
): RundownAction[] {
  for (let i = targetIndex - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.locked || r.segment.kind === 'fixed') break;
    if (r.segment.kind === 'buffer') {
      return [{ type: 'UPDATE_DURATION', id: r.segment.id, duration: r.segment.duration + need }];
    }
  }
  const targetId = rows[targetIndex].segment.id;
  const venueList = state.segments.filter((s) => (s.venue ?? 'A') === venueId);
  const targetVenueIndex = venueList.findIndex((s) => s.id === targetId);
  // 用场地内插入动作，避免全量索引错位
  return [
    {
      type: 'INSERT_IN_VENUE',
      venue: venueId,
      index: Math.max(0, targetVenueIndex),
      segment: {
        id: newId,
        title: '调度缓冲',
        venue: venueId,
        kind: 'buffer',
        duration: need,
        minDuration: 0,
        resourceIds: [],
      },
    },
  ];
}

/** 把候选动作施加到草稿 segments（用于模拟）；支持建议生成器用到的动作 */
function applyToDraft(draft: Segment[], actions: RundownAction[]): void {
  for (const ac of actions) {
    if (ac.type === 'UPDATE_DURATION') {
      const s = draft.find((x) => x.id === ac.id);
      if (s) s.duration = Math.max(0, Math.round(ac.duration));
    } else if (ac.type === 'UPDATE_FIXED_START') {
      const s = draft.find((x) => x.id === ac.id);
      if (s) s.fixedStartOffset = Math.max(0, Math.round(ac.offset));
    } else if (ac.type === 'INSERT_IN_VENUE') {
      let idx = draft.findIndex((s) => (s.venue ?? 'A') === ac.venue);
      if (idx < 0) {
        draft.push({ ...ac.segment, venue: ac.venue });
        continue;
      }
      // 找到该场地第 index 个环节的位置
      let seen = 0;
      let insertAt = -1;
      for (let i = 0; i < draft.length; i++) {
        if ((draft[i].venue ?? 'A') !== ac.venue) continue;
        if (seen === ac.index) {
          insertAt = i;
          break;
        }
        seen++;
      }
      if (insertAt < 0) {
        // 放到该场地最后一个环节之后
        let last = idx;
        for (let i = 0; i < draft.length; i++) if ((draft[i].venue ?? 'A') === ac.venue) last = i;
        insertAt = last + 1;
      }
      draft.splice(insertAt, 0, { ...ac.segment, venue: ac.venue });
    }
  }
}

function buildAdvices(
  conflict: { resourceNames: string[]; parties: [ConflictParty, ConflictParty] },
  state: RundownState,
  venueRowMap: Map<VenueId, ScheduledRow[]>,
  baseline: Simulation,
): AdjustmentAdvice[] {
  const [p1, p2] = conflict.parties;
  // a 为先开始的一方，b 为后开始的一方（a.start ≤ b.start）
  const [a, b] = p1.startOffset <= p2.startOffset ? [p1, p2] : [p2, p1];
  const advices: AdjustmentAdvice[] = [];
  const resName = conflict.resourceNames.join('、');
  const venueName = (v: VenueId) => (v === 'A' ? '主舞台' : '访谈间');

  const targetKey = pairKey(a.segmentId, b.segmentId);
  const evaluate = (
    id: string,
    kind: AdviceKind,
    tone: AdviceTone,
    summary: string,
    detail: string,
    action: RundownAction | null,
    draftFn: (() => Segment[]) | null,
    blockedReason?: string,
  ): AdjustmentAdvice => {
    let feasible = false;
    let reason = blockedReason;
    if (action && draftFn) {
      const sim = simulate(draftFn(), state.resources ?? []);
      if (sim.pairKeys.has(targetKey)) reason = '调整后两者仍然重叠';
      else if (sim.fixedOverBy > baseline.fixedOverBy) reason = '会突破固定开播点';
      else if ([...sim.pairKeys].some((k) => !baseline.pairKeys.has(k))) reason = '会引发新的资源碰撞';
      else feasible = true;
    }
    return {
      id, kind, tone, summary, detail,
      action: feasible ? action : null,
      feasible,
      blockedReason: feasible ? undefined : reason,
    };
  };

  const withActions = (actions: RundownAction[]): (() => Segment[]) => () => {
    const draft = state.segments.map((s) => ({ ...s }));
    applyToDraft(draft, actions);
    return draft;
  };

  const segA = state.segments.find((s) => s.id === a.segmentId)!;

  /**
   * 步进搜索：从理想目标量开始按 30 秒步进，对每个候选做「变换后重排」模拟，
   * 返回第一个消除本碰撞、不突破固定点、不引入新碰撞的动作。
   * 用于缩短/提前类候选，避免几何估算在环节已被压缩时失准。
   */
  const searchFeasible = (
    ideal: number,
    floor: number,
    makeAction: (trial: number) => RundownAction,
    step = 30,
  ): { trial: number; action: RundownAction } | null => {
    const start = Math.min(ideal, Math.floor(ideal / step) * step);
    for (let trial = start; trial >= floor; trial -= step) {
      const action = makeAction(trial);
      const draft = state.segments.map((s) => ({ ...s }));
      applyToDraft(draft, [action]);
      const sim = simulate(draft, state.resources ?? []);
      if (sim.pairKeys.has(targetKey)) continue;
      if (sim.fixedOverBy > baseline.fixedOverBy) continue;
      if ([...sim.pairKeys].some((k) => !baseline.pairKeys.has(k))) continue;
      return { trial, action };
    }
    return null;
  };

  // 1) 缩短先开始的一方：需让 a.end ≤ b.start（锁定行不可缩短；固定行缩短不动锚点）
  if (!a.locked) {
    const idealDur = Math.round(b.startOffset - a.startOffset);
    const floor = a.kind === 'compressible' ? Math.max(MIN_SEGMENT_DURATION, segA.minDuration) : MIN_SEGMENT_DURATION;
    const found = searchFeasible(idealDur, floor, (d) => ({
      type: 'UPDATE_DURATION',
      id: a.segmentId,
      duration: d,
    }));
    const currentComputed = Math.round(a.endOffset - a.startOffset);
    const cutAmount = found ? currentComputed - found.trial : currentComputed - idealDur;
    advices.push({
      id: 'shorten-a',
      kind: 'shorten-row',
      tone: 'compress',
      summary: `将${a.venueId === b.venueId ? '' : venueName(a.venueId)}「${a.title}」缩短 ${fmtDur(Math.max(0, cutAmount))}`,
      detail: `结束时间提前，让出「${resName}」；其后环节自动跟上，不整体顺延另一场地。`,
      action: found ? found.action : null,
      feasible: !!found,
      blockedReason: found
        ? undefined
        : `该环节最短只能到 ${fmtDur(floor)}，仍无法在「${b.title}」开始前让出资源`,
    });
  }

  // 2) 固定开播点互撞：四个移动方向都给出候选，由「变换后重排」模拟裁决
  //    a（先开始）：后移到 b 结束之后 / 前移到 b 开始之前结束
  if (a.kind === 'fixed' && !a.locked) {
    const aDuration = Math.round(a.endOffset - a.startOffset);
    const laterOffset = Math.round(b.endOffset);
    const actLater: RundownAction = { type: 'UPDATE_FIXED_START', id: a.segmentId, offset: laterOffset };
    advices.push(
      evaluate(
        'move-fixed-a-later', 'move-fixed', 'fix',
        `将「${a.title}」⚓ 后移到开播后 ${fmtDur(laterOffset)}`,
        `让「${resName}」先在${venueName(b.venueId)}用完；固定点之后的环节跟随新锚点，之前内容不受影响。`,
        actLater, withActions([actLater]),
      ),
    );
    const earlierOffset = Math.round(b.startOffset - aDuration);
    const actEarlier: RundownAction = { type: 'UPDATE_FIXED_START', id: a.segmentId, offset: Math.max(0, earlierOffset) };
    advices.push(
      evaluate(
        'move-fixed-a-earlier', 'move-fixed', 'fix',
        `将「${a.title}」⚓ 前移到开播后 ${fmtDur(Math.max(0, earlierOffset))}`,
        `使其在「${b.title}」开始前结束并让出「${resName}」；前移产生的提前量由${venueName(a.venueId)}缓冲与可压缩环节消化。`,
        earlierOffset >= 0 ? actEarlier : null,
        earlierOffset >= 0 ? withActions([actEarlier]) : null,
        earlierOffset < 0 ? '前移后开播点会早于开播时刻' : undefined,
      ),
    );
  }
  //    b（后开始）：前移到 a 开始之前 / 后移到 a 结束之后开始
  if (b.kind === 'fixed' && !b.locked) {
    const bDuration = Math.round(b.endOffset - b.startOffset);
    const earlierOffset = Math.round(a.startOffset - bDuration);
    const actEarlier: RundownAction = { type: 'UPDATE_FIXED_START', id: b.segmentId, offset: Math.max(0, earlierOffset) };
    advices.push(
      evaluate(
        'move-fixed-b-earlier', 'move-fixed', 'fix',
        `将「${b.title}」⚓ 前移到开播后 ${fmtDur(Math.max(0, earlierOffset))}`,
        `先让出「${resName}」；前移产生的提前量由${venueName(b.venueId)}缓冲与可压缩环节在固定点前消化。`,
        earlierOffset >= 0 ? actEarlier : null,
        earlierOffset >= 0 ? withActions([actEarlier]) : null,
        earlierOffset < 0 ? '前移后开播点会早于开播时刻' : undefined,
      ),
    );
    const laterOffset = Math.round(a.endOffset);
    const actLater: RundownAction = { type: 'UPDATE_FIXED_START', id: b.segmentId, offset: laterOffset };
    advices.push(
      evaluate(
        'move-fixed-b-later', 'move-fixed', 'fix',
        `将「${b.title}」⚓ 后移到开播后 ${fmtDur(laterOffset)}`,
        `等${venueName(a.venueId)}用完「${resName}」后再开播；固定点之后的环节跟随新锚点。`,
        actLater, withActions([actLater]),
      ),
    );
  }

  // 3) 整条提前后开始的一方：压缩其场地内、目标行之前的缓冲/可压缩环节
  if (!b.locked) {
    const rowsB = venueRowMap.get(b.venueId)!;
    const bIdx = rowsB.findIndex((r) => r.segment.id === b.segmentId);
    const advanceNeed = Math.round(b.endOffset - a.startOffset);
    const relief = reliefBeforePlanned(rowsB, bIdx);
    const acts = advanceActions(rowsB, bIdx, advanceNeed);
    advices.push(
      evaluate(
        'advance-b', 'advance-row', 'compress',
        `压缩${venueName(b.venueId)}前序环节，让「${b.title}」整条提前 ${fmtDur(advanceNeed)}`,
        `按先缓冲、后可压缩的顺序消化，使「${b.title}」在开播后 ${fmtDur(a.startOffset)} 前结束；固定点不移动。`,
        acts.length > 0 ? { type: 'BATCH', actions: acts } : null,
        acts.length > 0 ? withActions(acts) : null,
        acts.length === 0 ? advanceNote(relief, advanceNeed) : undefined,
      ),
    );
  }

  // 4) 整条提前先开始的一方（a 结束得更早，同样能让出资源）
  if (!a.locked) {
    const rowsA = venueRowMap.get(a.venueId)!;
    const aIdx = rowsA.findIndex((r) => r.segment.id === a.segmentId);
    const advanceNeed = Math.round(a.endOffset - b.startOffset);
    if (advanceNeed > 0) {
      const relief = reliefBeforePlanned(rowsA, aIdx);
      const acts = advanceActions(rowsA, aIdx, advanceNeed);
      advices.push(
        evaluate(
          'advance-a', 'advance-row', 'compress',
          `压缩${venueName(a.venueId)}前序环节，让「${a.title}」提前 ${fmtDur(advanceNeed)} 结束`,
          `把「${a.title}」之前的缓冲/可压缩环节压掉，使它在「${b.title}」开始前让出「${resName}」。`,
          acts.length > 0 ? { type: 'BATCH', actions: acts } : null,
          acts.length > 0 ? withActions(acts) : null,
          acts.length === 0 ? advanceNote(relief, advanceNeed) : undefined,
        ),
      );
    }
  }

  // 5) 顺延后开始的一方：撑大其前序缓冲（没有就插一个），让它在 a 结束后开始
  if (!b.locked && b.kind !== 'fixed') {
    const rowsB = venueRowMap.get(b.venueId)!;
    const bIdx = rowsB.findIndex((r) => r.segment.id === b.segmentId);
    const delayNeed = Math.round(a.endOffset - b.startOffset);
    const slack = slackAfter(rowsB, bIdx);
    const newBufferId = `buf-${a.segmentId}-${b.segmentId}`;
    const acts = delayActions(state, rowsB, bIdx, b.venueId, delayNeed, newBufferId);
    const slackText = slack === Infinity ? '尾部无固定点，可自由顺延' : `到下一固定点前有 ${fmtDur(Math.max(0, slack))} 空间`;
    advices.push(
      evaluate(
        'delay-b', 'delay-row', 'delay',
        `顺延${venueName(b.venueId)}「${b.title}」到 ${fmtDur(a.endOffset)} 开始`,
        `在其之前匀出 ${fmtDur(delayNeed)} 缓冲（不移动固定点、不压缩已执行内容）；${slackText}。`,
        acts.length > 0 ? { type: 'BATCH', actions: acts } : null,
        acts.length > 0 ? withActions(acts) : null,
        acts.length === 0 ? '没有可顺延的空间' : undefined,
      ),
    );
  }

  // 6) 跨场地互换：两个环节交换场地（保持时长与资源配置）
  if (a.venueId !== b.venueId && !a.locked && !b.locked) {
    advices.push(
      evaluate(
        'swap-venue', 'swap-venue', 'move',
        `交换场地：「${a.title}」↔「${b.title}」`,
        `两个环节互换场地（保持各自时长与资源配置），由各自场地重新排程。`,
        { type: 'SWAP_VENUE', aId: a.segmentId, bId: b.segmentId },
        () => {
          const draft = state.segments.map((s) => ({ ...s }));
          const sa = draft.find((x) => x.id === a.segmentId)!;
          const sb = draft.find((x) => x.id === b.segmentId)!;
          const va = sa.venue ?? 'A';
          sa.venue = sb.venue ?? 'A';
          sb.venue = va;
          return draft;
        },
      ),
    );
  }

  // 7) 锁定行：只能解锁已执行前缀后再调整（一键解锁，明确提示后果）
  for (const p of [a, b]) {
    if (p.locked) {
      advices.push({
        id: `unlock-${p.segmentId}`,
        kind: 'unlock-row',
        tone: 'unlock',
        summary: `解锁${venueName(p.venueId)}已执行前缀后再调整「${p.title}」`,
        detail: '该环节已按实际执行时刻锁定，排程引擎不会移动它；解锁会清除该场地全部实际时刻锚点（可撤销）。',
        action: { type: 'UNLOCK_VENUE', venue: p.venueId },
        feasible: true,
      });
    }
  }

  return advices;
}

const advanceNote = (relief: number, need: number): string | undefined =>
  relief < need ? `该方向前序缓冲与可压缩余量只有 ${fmtDur(relief)}，需要 ${fmtDur(need)}` : undefined;

/**
 * 检测跨场地共享资源碰撞。
 * 找出时间重叠且共享至少一种资源的环节对（同一对环节占用多个资源时合并为一条），
 * 生成碰撞区间、涉及环节与候选调整建议；建议经「变换后重排」模拟确认可行
 * （不突破固定点、不引入新碰撞）。
 */
export function detectResourceConflicts(state: RundownState): ResourceConflict[] {
  const resources = state.resources ?? [];
  const resourceName = new Map(resources.map((r) => [r.id, r.name]));
  const venueRows = venueRowsOf(state);
  const venueRowMap = new Map(venueRows.map((v) => [v.venueId, v.rows]));
  const baseline = simulate(state.segments, resources);

  // key = 环节对 → 命中的资源 id 集合
  const hits = new Map<string, { x: { row: ScheduledRow; venueId: VenueId }; y: { row: ScheduledRow; venueId: VenueId }; resIds: Set<string> }>();

  for (let vi = 0; vi < venueRows.length; vi++) {
    for (let vj = vi; vj < venueRows.length; vj++) {
      const left = venueRows[vi];
      const right = venueRows[vj];
      for (const rx of left.rows) {
        for (const ry of right.rows) {
          // 同场地同环节跳过；同场地也允许检测（如双锁定导致的碰撞）
          if (left.venueId === right.venueId && rx.segment.id === ry.segment.id) continue;
          if (!overlaps(rx, ry)) continue;
          const shared = (rx.segment.resourceIds ?? []).filter(
            (rid) => (ry.segment.resourceIds ?? []).includes(rid),
          );
          if (shared.length === 0) continue;
          const x = { row: rx, venueId: left.venueId };
          const y = { row: ry, venueId: right.venueId };
          const key = pairKey(rx.segment.id, ry.segment.id);
          const existing = hits.get(key);
          if (existing) {
            for (const rid of shared) existing.resIds.add(rid);
          } else {
            hits.set(key, { x, y, resIds: new Set(shared) });
          }
        }
      }
    }
  }

  const conflicts: ResourceConflict[] = [];
  for (const { x, y, resIds } of hits.values()) {
    const pair: [ConflictParty, ConflictParty] = [partyOf(x.venueId, x.row), partyOf(y.venueId, y.row)];
    const start = Math.max(x.row.startOffset, y.row.startOffset);
    const end = Math.min(x.row.endOffset, y.row.endOffset);
    const names = [...resIds].map((id) => resourceName.get(id) ?? id);
    const advices = buildAdvices({ resourceNames: names, parties: pair }, state, venueRowMap, baseline);
    const feasibleCount = advices.filter((a) => a.feasible).length;
    let unsolvableReason: string | undefined;
    if (feasibleCount === 0) {
      if (pair.every((p) => p.locked)) {
        unsolvableReason = '两个环节都已按实际时刻锁定，常规调整无法消除碰撞；请先解锁已执行前缀。';
      } else if (pair.every((p) => p.kind === 'fixed')) {
        unsolvableReason = '两个固定开播点互相重叠，必须至少移动其中一个固定点。';
      } else {
        unsolvableReason = '在当前固定开播点、压缩下限与已执行锁定约束下，已无可行调整；请移动固定点、解锁前缀或删减环节。';
      }
    }
    conflicts.push({
      id: pairKey(x.row.segment.id, y.row.segment.id),
      resourceIds: [...resIds],
      resourceName: names.join('、'),
      startOffset: start,
      endOffset: end,
      duration: end - start,
      parties: pair,
      advices,
      unsolvable: feasibleCount === 0,
      unsolvableReason,
    });
  }
  // 按碰撞开始时间排序，早的先报
  conflicts.sort((c1, c2) => c1.startOffset - c2.startOffset);
  return conflicts;
}
