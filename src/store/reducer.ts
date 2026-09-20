import type { RundownState, Segment, SegmentKind } from '../types';
import { MIN_SEGMENT_DURATION } from '../types';
import { computeVenueSchedule } from '../engine/schedule';
import { applyOps, lastLockedIndex } from '../engine/resources';
import type { StateOp } from '../engine/resources';
import { createDefaultShow } from './defaultShow';

export { MIN_SEGMENT_DURATION };

/** 撤销/重做历史栈：present 为唯一数据源，时间轴与冲突全部由它推导 */
export interface HistoryState {
  past: RundownState[];
  present: RundownState;
  future: RundownState[];
}

const HISTORY_LIMIT = 100;

export type RundownAction =
  | { type: 'UPDATE_DURATION'; venueId: string; id: string; duration: number }
  | { type: 'UPDATE_TITLE'; venueId: string; id: string; title: string }
  | { type: 'UPDATE_RESOURCES'; venueId: string; id: string; resources: string[] }
  | { type: 'CHANGE_KIND'; venueId: string; id: string; kind: Exclude<SegmentKind, 'fixed'> }
  | { type: 'TOGGLE_FIXED'; venueId: string; id: string }
  | { type: 'UPDATE_FIXED_START'; venueId: string; id: string; offset: number }
  | { type: 'REORDER'; venueId: string; from: number; to: number }
  | { type: 'INSERT_AT'; venueId: string; index: number; segment: Segment }
  | { type: 'DELETE'; venueId: string; id: string }
  | { type: 'MOVE_BETWEEN_VENUES'; segmentId: string; fromVenueId: string; toVenueId: string; index: number }
  | { type: 'APPLY_OPS'; ops: StateOp[] }
  | { type: 'LOCK_EXECUTED'; offset: number }
  | { type: 'CLEAR_EXECUTED_LOCKS' }
  | { type: 'SET_SHOW_START'; seconds: number }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function createInitialHistory(): HistoryState {
  return { past: [], present: createDefaultShow(), future: [] };
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

/** 各场地「已执行前缀」锁定的环节集合（由排程推导，与引擎口径一致） */
function lockedIdsByVenue(present: RundownState): Map<string, Set<string>> {
  return new Map(
    present.venues.map((v) => [
      v.id,
      computeVenueSchedule(v, present.executedUntil[v.id] ?? 0).lockedIds,
    ]),
  );
}

function isLocked(locks: Map<string, Set<string>>, venueId: string, segmentId: string): boolean {
  return locks.get(venueId)?.has(segmentId) ?? false;
}

function mapVenueSegments(
  state: HistoryState,
  venueId: string,
  fn: (s: Segment) => Segment,
): HistoryState {
  return commit(state, {
    ...state.present,
    venues: state.present.venues.map((v) =>
      v.id === venueId ? { ...v, segments: v.segments.map(fn) } : v,
    ),
  });
}

function venueOf(state: RundownState, venueId: string) {
  return state.venues.find((v) => v.id === venueId);
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
    case 'RESET':
      return commit(state, createDefaultShow());

    case 'UPDATE_DURATION': {
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      return mapVenueSegments(state, action.venueId, (s) =>
        s.id === action.id ? { ...s, duration: clampDuration(s, action.duration) } : s,
      );
    }

    case 'UPDATE_TITLE': {
      const title = action.title.trim();
      if (!title) return state;
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      return mapVenueSegments(state, action.venueId, (s) => (s.id === action.id ? { ...s, title } : s));
    }

    case 'UPDATE_RESOURCES': {
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      const resources = [...new Set(action.resources.map((r) => r.trim()).filter(Boolean))];
      return mapVenueSegments(state, action.venueId, (s) =>
        s.id === action.id ? { ...s, resources } : s,
      );
    }

    case 'CHANGE_KIND': {
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      return mapVenueSegments(state, action.venueId, (s) => {
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
      });
    }

    case 'TOGGLE_FIXED': {
      const locks = lockedIdsByVenue(state.present);
      if (isLocked(locks, action.venueId, action.id)) return state;
      const venue = venueOf(state.present, action.venueId);
      const target = venue?.segments.find((s) => s.id === action.id);
      if (!venue || !target) return state;
      if (target.kind === 'fixed') {
        return mapVenueSegments(state, action.venueId, (s) =>
          s.id === action.id ? { ...s, kind: 'normal', fixedStartOffset: undefined } : s,
        );
      }
      // 以当前排程中的开始时间作为固定开播点，设置后不扰动现有流程
      const schedule = computeVenueSchedule(venue, state.present.executedUntil[venue.id] ?? 0).result;
      const row = schedule.rows.find((r) => r.kind === 'segment' && r.segment.id === action.id);
      const offset = row && row.kind === 'segment' ? row.startOffset : 0;
      return mapVenueSegments(state, action.venueId, (s) =>
        s.id === action.id ? { ...s, kind: 'fixed', fixedStartOffset: offset, minDuration: 0 } : s,
      );
    }

    case 'UPDATE_FIXED_START': {
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      return mapVenueSegments(state, action.venueId, (s) =>
        s.id === action.id && s.kind === 'fixed'
          ? { ...s, fixedStartOffset: Math.max(0, Math.round(action.offset)) }
          : s,
      );
    }

    case 'REORDER': {
      const { venueId, from, to } = action;
      const venue = venueOf(state.present, venueId);
      if (!venue) return state;
      const segments = [...venue.segments];
      if (from < 0 || from >= segments.length || to < 0 || to > segments.length) return state;
      if (from === to || from + 1 === to) return state;
      // 已执行前缀内的环节位置不可改变
      const locks = lockedIdsByVenue(state.present);
      const lastLocked = lastLockedIndex(venue, locks.get(venueId) ?? new Set());
      if (from <= lastLocked || to <= lastLocked) return state;
      const [moved] = segments.splice(from, 1);
      segments.splice(from < to ? to - 1 : to, 0, moved);
      return commit(state, {
        ...state.present,
        venues: state.present.venues.map((v) => (v.id === venueId ? { ...v, segments } : v)),
      });
    }

    case 'INSERT_AT': {
      const venue = venueOf(state.present, action.venueId);
      if (!venue) return state;
      const locks = lockedIdsByVenue(state.present);
      const lastLocked = lastLockedIndex(venue, locks.get(action.venueId) ?? new Set());
      const index = Math.max(0, Math.min(Math.round(action.index), venue.segments.length));
      if (index <= lastLocked) return state; // 不能在已执行前缀之前插入
      const segment: Segment = { ...action.segment, resources: action.segment.resources ?? [] };
      const segments = [...venue.segments];
      segments.splice(index, 0, segment);
      return commit(state, {
        ...state.present,
        venues: state.present.venues.map((v) => (v.id === action.venueId ? { ...v, segments } : v)),
      });
    }

    case 'DELETE': {
      const venue = venueOf(state.present, action.venueId);
      if (!venue || venue.segments.length <= 1) return state;
      if (isLocked(lockedIdsByVenue(state.present), action.venueId, action.id)) return state;
      return commit(state, {
        ...state.present,
        venues: state.present.venues.map((v) =>
          v.id === action.venueId
            ? { ...v, segments: v.segments.filter((s) => s.id !== action.id) }
            : v,
        ),
      });
    }

    case 'MOVE_BETWEEN_VENUES': {
      const { segmentId, fromVenueId, toVenueId } = action;
      if (fromVenueId === toVenueId) return state;
      const target = venueOf(state.present, toVenueId);
      if (!venueOf(state.present, fromVenueId) || !target) return state;
      const locks = lockedIdsByVenue(state.present);
      if (isLocked(locks, fromVenueId, segmentId)) return state;
      const index = Math.max(0, Math.min(Math.round(action.index), target.segments.length));
      if (index <= lastLockedIndex(target, locks.get(toVenueId) ?? new Set())) return state;
      return commit(state, applyOps(state.present, [{ type: 'move', segmentId, fromVenueId, toVenueId, index }]));
    }

    case 'APPLY_OPS': {
      const locks = lockedIdsByVenue(state.present);
      for (const op of action.ops) {
        if (op.type === 'set-duration') {
          if (isLocked(locks, op.venueId, op.segmentId)) return state;
        } else if (op.type === 'insert') {
          const venue = venueOf(state.present, op.venueId);
          if (!venue) return state;
          const index = Math.max(0, Math.min(Math.round(op.index), venue.segments.length));
          if (index <= lastLockedIndex(venue, locks.get(op.venueId) ?? new Set())) return state;
        } else {
          const target = venueOf(state.present, op.toVenueId);
          if (!venueOf(state.present, op.fromVenueId) || !target) return state;
          if (isLocked(locks, op.fromVenueId, op.segmentId)) return state;
          const index = Math.max(0, Math.min(Math.round(op.index), target.segments.length));
          if (index <= lastLockedIndex(target, locks.get(op.toVenueId) ?? new Set())) return state;
        }
      }
      return commit(state, applyOps(state.present, action.ops));
    }

    case 'LOCK_EXECUTED': {
      const offset = Math.max(0, Math.round(action.offset));
      if (offset <= 0) return state;
      return commit(state, {
        ...state.present,
        executedUntil: Object.fromEntries(state.present.venues.map((v) => [v.id, offset])),
      });
    }

    case 'CLEAR_EXECUTED_LOCKS': {
      if (Object.keys(state.present.executedUntil).length === 0) return state;
      return commit(state, { ...state.present, executedUntil: {} });
    }

    case 'SET_SHOW_START':
      return commit(state, {
        ...state.present,
        showStartSeconds: Math.max(0, Math.round(action.seconds)),
      });

    default:
      return state;
  }
}
