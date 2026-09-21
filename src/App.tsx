import { useEffect, useMemo, useReducer } from 'react';
import { computeShowSchedule } from './engine/showSchedule';
import { createInitialHistory, rundownReducer } from './store/reducer';
import { createDualVenueShow } from './store/defaultShow';
import { loadHistory, saveHistory } from './store/persistence';
import { RundownProvider } from './store/RundownContext';
import { usePlayhead } from './hooks/usePlayhead';
import { HeaderBar } from './components/HeaderBar';
import { AlertsPanel } from './components/AlertsPanel';
import { ResourceBar } from './components/ResourceBar';
import { VenueColumn } from './components/VenueColumn';

export default function App() {
  const [history, dispatch] = useReducer(
    rundownReducer,
    createInitialHistory(createDualVenueShow()),
    (initial) => {
      try {
        return loadHistory() ?? initial;
      } catch {
        return initial;
      }
    },
  );

  // 任何状态变化都写入浏览器本地（含撤销/重做栈，刷新原样恢复）
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // 两条场地时间线、消化明细、固定点冲突、跨场地资源碰撞全部由 present 推导
  const show = useMemo(() => computeShowSchedule(history.present), [history.present]);
  const playhead = usePlayhead(show.endOffset);

  // 快捷键：空格 播放/暂停，Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z / Ctrl+Y 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        playhead.toggle();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playhead]);

  return (
    <RundownProvider
      value={{
        present: history.present,
        show,
        dispatch,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
      }}
    >
      <div className="console">
        <HeaderBar playhead={playhead} />
        <AlertsPanel />
        <ResourceBar />
        <div className="venue-grid">
          {show.venues.map((v) => (
            <VenueColumn key={v.venueId} venueId={v.venueId} playhead={playhead} />
          ))}
        </div>
        <footer className="footer-hints">
          拖动 ⠿ 可在同场地排序、也可跨场地搬运 · 点击时长修改 · 📌 设为固定开播点 ·
          🔒 锁定实际已执行前缀 · 空格 播放/暂停 · Ctrl/⌘+Z 撤销 · Ctrl/⌘+Shift+Z 重做 ·
          数据自动保存在浏览器本地
        </footer>
      </div>
    </RundownProvider>
  );
}
