import type { HistoryState } from './reducer';

const KEY = 'rundown-console:v1';

/** 从 localStorage 恢复（含撤销/重做栈）；数据缺失或损坏时返回 null */
export function loadHistory(): HistoryState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HistoryState> | null;
    if (!parsed || !parsed.present || !Array.isArray(parsed.present.segments)) return null;
    return {
      past: Array.isArray(parsed.past) ? parsed.past : [],
      present: parsed.present,
      future: Array.isArray(parsed.future) ? parsed.future : [],
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
