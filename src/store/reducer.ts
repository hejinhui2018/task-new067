import type { RundownState, Segment, SegmentKind } from '../types';
import { computeSchedule } from '../engine/schedule';
import { createDefaultShow } from './defaultShow';

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
  | { type: 'REORDER'; from: number; to: number }
  | { type: 'INSERT_AT'; index: number; segment: Segment }
  | { type: 'DELETE'; id: string }
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

function mapSegments(state: HistoryState, fn: (s: Segment) => Segment): HistoryState {
  return commit(state, { ...state.present, segments: state.present.segments.map(fn) });
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

    case 'UPDATE_DURATION':
      return mapSegments(state, (s) =>
        s.id === action.id ? { ...s, duration: clampDuration(s, action.duration) } : s,
      );

    case 'UPDATE_TITLE': {
      const title = action.title.trim();
      if (!title) return state;
      return mapSegments(state, (s) => (s.id === action.id ? { ...s, title } : s));
    }

    case 'CHANGE_KIND':
      return mapSegments(state, (s) => {
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

    case 'TOGGLE_FIXED': {
      const target = state.present.segments.find((s) => s.id === action.id);
      if (!target) return state;
      if (target.kind === 'fixed') {
        return mapSegments(state, (s) =>
          s.id === action.id ? { ...s, kind: 'normal', fixedStartOffset: undefined } : s,
        );
      }
      // 以当前排程中的开始时间作为固定开播点，设置后不扰动现有流程
      const schedule = computeSchedule(state.present.segments);
      const row = schedule.rows.find((r) => r.kind === 'segment' && r.segment.id === action.id);
      const offset = row && row.kind === 'segment' ? row.startOffset : 0;
      return mapSegments(state, (s) =>
        s.id === action.id ? { ...s, kind: 'fixed', fixedStartOffset: offset, minDuration: 0 } : s,
      );
    }

    case 'UPDATE_FIXED_START':
      return mapSegments(state, (s) =>
        s.id === action.id && s.kind === 'fixed'
          ? { ...s, fixedStartOffset: Math.max(0, Math.round(action.offset)) }
          : s,
      );

    case 'REORDER': {
      const { from, to } = action;
      const segments = [...state.present.segments];
      if (from < 0 || from >= segments.length || to < 0 || to > segments.length) return state;
      if (from === to || from + 1 === to) return state;
      const [moved] = segments.splice(from, 1);
      segments.splice(from < to ? to - 1 : to, 0, moved);
      return commit(state, { ...state.present, segments });
    }

    case 'INSERT_AT': {
      const segments = [...state.present.segments];
      const index = Math.max(0, Math.min(Math.round(action.index), segments.length));
      segments.splice(index, 0, action.segment);
      return commit(state, { ...state.present, segments });
    }

    case 'DELETE': {
      if (state.present.segments.length <= 1) return state;
      return commit(state, {
        ...state.present,
        segments: state.present.segments.filter((s) => s.id !== action.id),
      });
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
