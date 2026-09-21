import type { RundownState, Segment } from '../types';
import type { HistoryState } from './reducer';

const KEY = 'rundown-console:v2';
const LEGACY_KEY = 'rundown-console:v1';

/** 旧版单时间线数据迁移：所有环节归入主舞台 A */
function migrateV1(legacy: Partial<HistoryState>): HistoryState | null {
  const migrateState = (s: Partial<RundownState> | undefined | null): RundownState | null => {
    if (!s || !Array.isArray(s.segments)) return null;
    const segments: Segment[] = s.segments.map((seg) => ({
      ...seg,
      venue: 'A' as const,
      resourceIds: seg.resourceIds ?? [],
    }));
    return {
      showName: s.showName ?? '晚间直播',
      showStartSeconds: s.showStartSeconds ?? 10 * 3600,
      slotDuration: s.slotDuration ?? 30 * 60,
      segments,
      venues: [{ id: 'A' as const, name: '主舞台' }],
      resources: s.resources ?? [],
    };
  };
  const present = migrateState(legacy.present);
  if (!present) return null;
  return {
    past: (Array.isArray(legacy.past) ? legacy.past : [])
      .map(migrateState)
      .filter((s): s is RundownState => s !== null),
    present,
    future: (Array.isArray(legacy.future) ? legacy.future : [])
      .map(migrateState)
      .filter((s): s is RundownState => s !== null),
  };
}

function parseHistory(raw: string): HistoryState | null {
  const parsed = JSON.parse(raw) as Partial<HistoryState> | null;
  if (!parsed || !parsed.present || !Array.isArray(parsed.present.segments)) return null;
  return {
    past: Array.isArray(parsed.past) ? parsed.past : [],
    present: parsed.present,
    future: Array.isArray(parsed.future) ? parsed.future : [],
  };
}

/** 从 localStorage 恢复（含撤销/重做栈）；优先读 v2，回退迁移 v1；缺失/损坏返回 null */
export function loadHistory(): HistoryState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseHistory(raw);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<HistoryState> | null;
      if (parsed) return migrateV1(parsed);
    }
    return null;
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
