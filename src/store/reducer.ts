import type { RundownState, Segment, SegmentKind, SharedResource, VenueId } from '../types';
import { computeSchedule } from '../engine/schedule';
import { createDefaultShow, createDualVenueShow } from './defaultShow';

/** 撤销/重做历史栈：present 为唯一数据源，时间轴与冲突全部由它推导 */
export interface HistoryState {
  past: RundownState[];
  present: RundownState;
  future: RundownState[];
}

export const MIN_SEGMENT_DURATION = 30;
const HISTORY_LIMIT = 100;

export type RundownAction =
  | { type: 'UPDATE_DURATION'; id: string; duration: number }
  | { type: 'UPDATE_TITLE'; id: string; title: string }
  | { type: 'CHANGE_KIND'; id: string; kind: Exclude<SegmentKind, 'fixed'> }
  | { type: 'TOGGLE_FIXED'; id: string }
  | { type: 'UPDATE_FIXED_START'; id: string; offset: number }
  // —— 单场地时代保留的动作（按全量顺序操作，单场地仍等价） ——
  | { type: 'REORDER'; from: number; to: number }
  | { type: 'INSERT_AT'; index: number; segment: Segment }
  // —— 双场地动作 ——
  | { type: 'REORDER_VENUE'; venue: VenueId; from: number; to: number }
  | { type: 'MOVE_VENUE'; id: string; toVenue: VenueId; toIndex: number }
  | { type: 'SWAP_VENUE'; aId: string; bId: string }
  | { type: 'INSERT_IN_VENUE'; venue: VenueId; index: number; segment: Segment }
  | { type: 'SET_SEGMENT_RESOURCES'; id: string; resourceIds: string[] }
  | { type: 'ADD_RESOURCE'; resource: SharedResource }
  | { type: 'DELETE_RESOURCE'; id: string }
  | { type: 'LOCK_PREFIX'; venue: VenueId; upToId: string }
  | { type: 'UNLOCK_VENUE'; venue: VenueId }
  | { type: 'BATCH'; actions: RundownAction[] }
  | { type: 'DELETE'; id: string }
  | { type: 'SET_SHOW_START'; seconds: number }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function createInitialHistory(seed: RundownState = createDefaultShow()): HistoryState {
  return { past: [], present: seed, future: [] };
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `seg-${Math.random().toString(36).slice(2, 10)}`;
}

function commit(state: HistoryState, next: RundownState): HistoryState {
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

/** 时长下限：缓冲可到 0，可压缩环节不低于其压缩下限，其余不低于 MIN_SEGMENT_DURATION */
function clampDuration(seg: Segment, requested: number): number {
  const floor = seg.kind === 'buffer' ? 0 : MIN_SEGMENT_DURATION;
  const minByKind = seg.kind === 'compressible' ? seg.minDuration : 0;
  return Math.max(Math.round(requested), floor, minByKind);
}

const venueOf = (s: Segment): VenueId => s.venue ?? 'A';
const venueSegments = (segments: Segment[], venue: VenueId) =>
  segments.filter((s) => venueOf(s) === venue);

/** 已执行锁定的环节不接受任何编辑/移动/删除 */
function isLocked(state: RundownState, id: string): boolean {
  return state.segments.some((s) => s.id === id && s.locked);
}

/**
 * 对 present 的纯变换（不产生历史记录）。
 * BATCH 与 reducer 本体都走这里，保证一组建议动作只产生一个撤销快照。
 */
function applyAction(present: RundownState, action: RundownAction): RundownState {
  switch (action.type) {
    case 'UPDATE_DURATION':
      if (isLocked(present, action.id)) return present;
      return {
        ...present,
        segments: present.segments.map((s) =>
          s.id === action.id ? { ...s, duration: clampDuration(s, action.duration) } : s,
        ),
      };

    case 'UPDATE_TITLE': {
      if (isLocked(present, action.id)) return present;
      const title = action.title.trim();
      if (!title) return present;
      return {
        ...present,
        segments: present.segments.map((s) => (s.id === action.id ? { ...s, title } : s)),
      };
    }

    case 'CHANGE_KIND':
      if (isLocked(present, action.id)) return present;
      return {
        ...present,
        segments: present.segments.map((s) => {
          if (s.id !== action.id) return s;
          const kind = action.kind;
          return {
            ...s,
            kind,
            fixedStartOffset: undefined,
            minDuration:
              kind === 'compressible'
                ? Math.max(MIN_SEGMENT_DURATION, Math.floor(s.duration * 0.6))
                : 0,
          };
        }),
      };

    case 'TOGGLE_FIXED': {
      const target = present.segments.find((s) => s.id === action.id);
      if (!target || target.locked) return present;
      if (target.kind === 'fixed') {
        return {
          ...present,
          segments: present.segments.map((s) =>
            s.id === action.id ? { ...s, kind: 'normal', fixedStartOffset: undefined } : s,
          ),
        };
      }
      // 以本场地当前排程中的开始时间作为固定开播点，设置后不扰动现有流程
      const venueSegs = venueSegments(present.segments, venueOf(target));
      const schedule = computeSchedule(venueSegs);
      const row = schedule.rows.find(
        (r) => r.kind === 'segment' && r.segment.id === action.id,
      );
      const offset = row && row.kind === 'segment' ? row.startOffset : 0;
      return {
        ...present,
        segments: present.segments.map((s) =>
          s.id === action.id ? { ...s, kind: 'fixed', fixedStartOffset: offset, minDuration: 0 } : s,
        ),
      };
    }

    case 'UPDATE_FIXED_START':
      if (isLocked(present, action.id)) return present;
      return {
        ...present,
        segments: present.segments.map((s) =>
          s.id === action.id && s.kind === 'fixed'
            ? { ...s, fixedStartOffset: Math.max(0, Math.round(action.offset)) }
            : s,
        ),
      };

    case 'REORDER': {
      const segments = [...present.segments];
      const { from, to } = action;
      if (from < 0 || from >= segments.length || to < 0 || to > segments.length) return present;
      if (from === to || from + 1 === to) return present;
      if (segments[from].locked) return present;
      const [moved] = segments.splice(from, 1);
      segments.splice(from < to ? to - 1 : to, 0, moved);
      return { ...present, segments };
    }

    case 'REORDER_VENUE': {
      const { venue, from, to } = action;
      const list = venueSegments(present.segments, venue);
      if (from < 0 || from >= list.length || to < 0 || to > list.length) return present;
      if (from === to || from + 1 === to) return present;
      // 已执行锁定前缀不可重排：from/to 都必须落在未锁定后缀内
      const firstUnlocked = list.findIndex((s) => !s.locked);
      const lockedLen = firstUnlocked === -1 ? list.length : firstUnlocked;
      if (from < lockedLen || to < lockedLen) return present;
      const suffix = list.slice(lockedLen);
      const sf = from - lockedLen;
      const st = to - lockedLen;
      const [moved] = suffix.splice(sf, 1);
      suffix.splice(sf < st ? st - 1 : st, 0, moved);
      return replaceVenueOrder(present, venue, [...list.slice(0, lockedLen), ...suffix]);
    }

    case 'INSERT_AT': {
      const segments = [...present.segments];
      const index = Math.max(0, Math.min(Math.round(action.index), segments.length));
      segments.splice(index, 0, action.segment);
      return { ...present, segments };
    }

    case 'INSERT_IN_VENUE': {
      const { venue } = action;
      const seg: Segment = { ...action.segment, venue };
      const list = venueSegments(present.segments, venue);
      // 新环节只能插在已执行锁定前缀之后
      const firstUnlocked = list.findIndex((s) => !s.locked);
      const lockedLen = firstUnlocked === -1 ? list.length : firstUnlocked;
      const clamped = Math.max(lockedLen, Math.min(Math.round(action.index), list.length));
      const reordered = [...list];
      reordered.splice(clamped, 0, seg);
      return replaceVenueOrder(present, venue, reordered);
    }

    case 'MOVE_VENUE': {
      const target = present.segments.find((s) => s.id === action.id);
      if (!target || target.locked) return present;
      const fromVenue = venueOf(target);
      const without = present.segments.filter((s) => s.id !== action.id);
      const destList = venueSegments(without, action.toVenue).map((s) => ({ ...s }));
      // 目标场地只能落到已执行锁定前缀之后
      const firstUnlocked = destList.findIndex((s) => !s.locked);
      const destLockedLen = firstUnlocked === -1 ? destList.length : firstUnlocked;
      const moved: Segment = { ...target, venue: action.toVenue };
      const clamped = Math.max(destLockedLen, Math.min(Math.round(action.toIndex), destList.length));
      destList.splice(clamped, 0, moved);
      let next: Segment[];
      if (fromVenue !== action.toVenue) {
        const srcList = venueSegments(without, fromVenue);
        next = mergeVenueLists(without, [
          { venue: fromVenue, list: srcList },
          { venue: action.toVenue, list: destList },
        ]);
      } else {
        next = replaceVenueOrder({ ...present, segments: without }, action.toVenue, destList).segments;
      }
      return { ...present, segments: next };
    }

    case 'SWAP_VENUE': {
      const a = present.segments.find((s) => s.id === action.aId);
      const b = present.segments.find((s) => s.id === action.bId);
      if (!a || !b || a.locked || b.locked) return present;
      const va = venueOf(a);
      const vb = venueOf(b);
      if (va === vb) return present;
      return {
        ...present,
        segments: present.segments.map((s) => {
          if (s.id === a.id) return { ...s, venue: vb };
          if (s.id === b.id) return { ...s, venue: va };
          return s;
        }),
      };
    }

    case 'DELETE': {
      if (isLocked(present, action.id)) return present;
      if (present.segments.length <= 1) return present;
      return {
        ...present,
        segments: present.segments.filter((s) => s.id !== action.id),
      };
    }

    case 'SET_SEGMENT_RESOURCES':
      if (isLocked(present, action.id)) return present;
      return {
        ...present,
        segments: present.segments.map((s) =>
          s.id === action.id ? { ...s, resourceIds: [...new Set(action.resourceIds)] } : s,
        ),
      };

    case 'ADD_RESOURCE': {
      if (present.resources?.some((r) => r.id === action.resource.id)) return present;
      return { ...present, resources: [...(present.resources ?? []), action.resource] };
    }

    case 'DELETE_RESOURCE': {
      if (!present.resources?.some((r) => r.id === action.id)) return present;
      return {
        ...present,
        resources: present.resources.filter((r) => r.id !== action.id),
        segments: present.segments.map((s) =>
          s.resourceIds?.includes(action.id)
            ? { ...s, resourceIds: s.resourceIds.filter((r) => r !== action.id) }
            : s,
        ),
      };
    }

    case 'LOCK_PREFIX': {
      const target = present.segments.find((s) => s.id === action.upToId);
      if (!target || target.locked) return present;
      const venue = action.venue;
      const list = venueSegments(present.segments, venue);
      const upto = list.findIndex((s) => s.id === action.upToId);
      if (upto < 0) return present;
      const schedule = computeSchedule(list);
      const lockIds = new Set(list.slice(0, upto + 1).map((s) => s.id));
      // 不允许把锁定前缀延伸到尚未消化的固定点冲突之后（不能锁定放不下的时刻）
      if (schedule.conflicts.some((c) => lockIds.has(c.fixedSegmentId))) return present;
      const rowStart = new Map(
        schedule.rows
          .filter((r) => r.kind === 'segment')
          .map((r) => [r.segment.id, { start: r.startOffset, end: r.endOffset }]),
      );
      return {
        ...present,
        segments: present.segments.map((s) => {
          if (!lockIds.has(s.id)) return s;
          const at = rowStart.get(s.id);
          return {
            ...s,
            locked: true,
            actualStartOffset: at?.start ?? s.actualStartOffset ?? 0,
            actualEndOffset: at?.end ?? s.actualEndOffset ?? s.duration,
          };
        }),
      };
    }

    case 'UNLOCK_VENUE':
      return {
        ...present,
        segments: present.segments.map((s) =>
          venueOf(s) === action.venue && s.locked
            ? { ...s, locked: false, actualStartOffset: undefined, actualEndOffset: undefined }
            : s,
        ),
      };

    case 'SET_SHOW_START':
      return { ...present, showStartSeconds: Math.max(0, Math.round(action.seconds)) };

    case 'BATCH': {
      return action.actions.reduce((p, a) => applyAction(p, a), present);
    }

    default:
      return present;
  }
}

/** 用新的场地内顺序替换该场地环节，其他场地保持原全量相对顺序 */
function replaceVenueOrder(present: RundownState, venue: VenueId, list: Segment[]): RundownState {
  const others: Array<{ venue: VenueId; list: Segment[] }> = [
    ...new Set(present.segments.map((s) => venueOf(s)).filter((v) => v !== venue)),
  ].map((v) => ({ venue: v, list: venueSegments(present.segments, v) }));
  return { ...present, segments: mergeVenueLists(present.segments, [{ venue, list }, ...others]) };
}

/**
 * 按场地分组的有序列表合并回全量 segments：
 * 保持各场地内部给定顺序，场地间沿用原全量序列的相对先后（稳定交错）。
 */
function mergeVenueLists(
  original: Segment[],
  groups: Array<{ venue: VenueId; list: Segment[] }>,
): Segment[] {
  const queues = new Map(groups.map((g) => [g.venue, [...g.list]]));
  const result: Segment[] = [];
  for (const s of original) {
    const q = queues.get(venueOf(s));
    if (q && q.length > 0) result.push(q.shift()!);
  }
  for (const q of queues.values()) result.push(...q);
  return result;
}

export function rundownReducer(state: HistoryState, action: RundownAction): HistoryState {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const [next, ...future] = state.future;
      return { past: [...state.past, state.present], present: next, future };
    }
    case 'RESET': {
      const seed = state.present.venues && state.present.venues.length > 1
        ? createDualVenueShow()
        : createDefaultShow();
      return commit(state, seed);
    }
    default: {
      const next = applyAction(state.present, action);
      return next === state.present ? state : commit(state, next);
    }
  }
}
