import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHistory, saveHistory } from './persistence';
import { createInitialHistory } from './reducer';

/** node 环境下的 localStorage 内存替身 */
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('持久化与刷新恢复', () => {
  it('保存后可原样恢复（含撤销栈、双场地与已执行锁定）', () => {
    const store = stubLocalStorage();
    let h = createInitialHistory();
    h = { ...h, present: { ...h.present, executedUntil: { main: 600, 'interview-room': 600 } } };
    h = { past: [createInitialHistory().present], present: h.present, future: [] };
    saveHistory(h);

    const raw = store.get('rundown-console:v1');
    expect(raw).toBeTruthy();

    const loaded = loadHistory();
    expect(loaded).not.toBeNull();
    expect(loaded!.present.venues).toHaveLength(2);
    expect(loaded!.present.executedUntil).toEqual({ main: 600, 'interview-room': 600 });
    expect(loaded!.past).toHaveLength(1);
    expect(loaded!.present.venues[0].segments.map((s) => s.id)).toContain('interview');
  });

  it('v1 单时间线数据自动迁移为双场地（包进主舞台）', () => {
    stubLocalStorage();
    const v1 = {
      past: [],
      present: {
        showName: '旧节目',
        showStartSeconds: 36000,
        slotDuration: 1800,
        segments: [
          { id: 'a', title: '开场', kind: 'normal', duration: 120, minDuration: 0 },
          { id: 'f', title: '连线', kind: 'fixed', duration: 300, minDuration: 0, fixedStartOffset: 900 },
        ],
      },
      future: [],
    };
    localStorage.setItem('rundown-console:v1', JSON.stringify(v1));

    const loaded = loadHistory();
    expect(loaded).not.toBeNull();
    expect(loaded!.present.venues).toHaveLength(1);
    expect(loaded!.present.venues[0].name).toBe('主舞台');
    expect(loaded!.present.venues[0].segments).toHaveLength(2);
    // 旧数据没有 resources 字段 → 规范化为空数组；固定点保留
    expect(loaded!.present.venues[0].segments[0].resources).toEqual([]);
    expect(loaded!.present.venues[0].segments[1].fixedStartOffset).toBe(900);
    expect(loaded!.present.executedUntil).toEqual({});
  });

  it('损坏或缺失的数据返回 null（回退到内置节目单）', () => {
    const store = stubLocalStorage();
    expect(loadHistory()).toBeNull();
    store.set('rundown-console:v1', '{not json');
    expect(loadHistory()).toBeNull();
    store.set('rundown-console:v1', JSON.stringify({ present: { venues: [] } }));
    expect(loadHistory()).toBeNull();
    store.set('rundown-console:v1', JSON.stringify({ present: { segments: 'oops' } }));
    expect(loadHistory()).toBeNull();
  });
});
