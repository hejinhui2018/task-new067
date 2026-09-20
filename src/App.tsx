import { useEffect, useMemo, useReducer } from 'react';
import { computeShowSchedule } from './engine/multiSchedule';
import { createInitialHistory, rundownReducer } from './store/reducer';
import { loadHistory, saveHistory } from './store/persistence';
import { RundownProvider } from './store/RundownContext';
import { usePlayhead } from './hooks/usePlayhead';
import { HeaderBar } from './components/HeaderBar';
import { TimelineStrip } from './components/TimelineStrip';
import { AlertsPanel } from './components/AlertsPanel';
import { RundownTable } from './components/RundownTable';

export default function App() {
  const [history, dispatch] = useReducer(rundownReducer, createInitialHistory(), (initial) => {
    try {
      return loadHistory() ?? initial;
    } catch {
      return initial;
    }
  });

  // 任何状态变化都写入浏览器本地
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // 各场地时间轴、消化明细、固定点冲突、跨场地资源冲突全部由 present 推导
  const schedule = useMemo(() => computeShowSchedule(history.present), [history.present]);
  const playhead = usePlayhead(schedule.endOffset);

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
        schedule,
        dispatch,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
      }}
    >
      <div className="console">
        <HeaderBar playhead={playhead} />
        <TimelineStrip playhead={playhead} />
        <AlertsPanel />
        <RundownTable playheadOffset={playhead.offset} />
        <footer className="footer-hints">
          拖动 ⠿ 在本场地排序或移到另一场地 · 点击时长修改 · 🏷 编辑共享资源 · 📌 设为固定开播点 ·
          ▶ 预演后可「锁定已执行前缀」· 空格 播放/暂停 · Ctrl/⌘+Z 撤销 · Ctrl/⌘+Shift+Z 重做 ·
          数据自动保存在浏览器本地
        </footer>
      </div>
    </RundownProvider>
  );
}
