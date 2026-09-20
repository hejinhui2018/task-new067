import type { RundownState, Segment, Venue } from '../types';
import type { HistoryState } from './reducer';

const KEY = 'rundown-console:v1';

function normalizeSegment(raw: unknown): Segment | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.title !== 'string') return null;
  const kind =
    s.kind === 'compressible' || s.kind === 'buffer' || s.kind === 'fixed' ? s.kind : 'normal';
  return {
    id: s.id,
    title: s.title,
    kind,
    duration: typeof s.duration === 'number' && Number.isFinite(s.duration) ? s.duration : 60,
    minDuration: typeof s.minDuration === 'number' && Number.isFinite(s.minDuration) ? s.minDuration : 0,
    fixedStartOffset:
      typeof s.fixedStartOffset === 'number' && Number.isFinite(s.fixedStartOffset)
        ? s.fixedStartOffset
        : undefined,
    resources: Array.isArray(s.resources)
      ? s.resources.filter((r): r is string => typeof r === 'string')
      : [],
  };
}

function normalizeVenue(raw: unknown, fallbackId: string): Venue | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.segments)) return null;
  const segments = v.segments.map(normalizeSegment).filter((s): s is Segment => s !== null);
  if (segments.length === 0) return null;
  return {
    id: typeof v.id === 'string' ? v.id : fallbackId,
    name: typeof v.name === 'string' ? v.name : '场地',
    segments,
  };
}

/**
 * 兼容两种历史数据：
 * - v2：{ venues, executedUntil, ... }（双场地联排）
 * - v1：{ segments, ... }（单时间线）→ 包进「主舞台」，资源与锁定置空
 */
function migratePresent(raw: unknown): RundownState | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  const base = {
    showName: typeof p.showName === 'string' ? p.showName : '直播',
    showStartSeconds:
      typeof p.showStartSeconds === 'number' && Number.isFinite(p.showStartSeconds)
        ? p.showStartSeconds
        : 10 * 3600,
    slotDuration:
      typeof p.slotDuration === 'number' && Number.isFinite(p.slotDuration)
        ? p.slotDuration
        : 30 * 60,
  };

  if (Array.isArray(p.venues)) {
    const venues = p.venues
      .map((v, i) => normalizeVenue(v, `venue-${i + 1}`))
      .filter((v): v is Venue => v !== null);
    if (venues.length === 0) return null;
    const executedUntil: Record<string, number> = {};
    if (p.executedUntil && typeof p.executedUntil === 'object') {
      for (const [k, val] of Object.entries(p.executedUntil as Record<string, unknown>)) {
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) executedUntil[k] = val;
      }
    }
    return { ...base, venues, executedUntil };
  }

  if (Array.isArray(p.segments)) {
    const segments = p.segments.map(normalizeSegment).filter((s): s is Segment => s !== null);
    if (segments.length === 0) return null;
    return {
      ...base,
      venues: [{ id: 'main', name: '主舞台', segments }],
      executedUntil: {},
    };
  }

  return null;
}

/** 从 localStorage 恢复（含撤销/重做栈）；数据缺失或损坏时返回 null */
export function loadHistory(): HistoryState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HistoryState> | null;
    if (!parsed) return null;
    const present = migratePresent(parsed.present);
    if (!present) return null;
    const migrateList = (list: unknown): RundownState[] =>
      Array.isArray(list)
        ? list.map(migratePresent).filter((s): s is RundownState => s !== null)
        : [];
    return {
      past: migrateList(parsed.past),
      present,
      future: migrateList(parsed.future),
    };
  } catch {
    return null;
  }
}

export function saveHistory(history: HistoryState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    // 存储配额满等情况：静默失败，不影响使用
  }
}
