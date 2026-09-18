import { useState } from 'react';
import { fmtClock, fmtDur, fmtSignedDur, parseClock } from '../engine/time';
import type { ScheduledRow } from '../engine/schedule';
import { useRundown } from '../store/RundownContext';
import type { Playhead } from '../hooks/usePlayhead';

function Stat({ label, value, tone, title }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; title?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`} title={title}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function HeaderBar({ playhead }: { playhead: Playhead }) {
  const { present, schedule, dispatch, canUndo, canRedo } = useRundown();
  const [editingStart, setEditingStart] = useState(false);

  const diff = schedule.endOffset - present.slotDuration;
  const fixedCount = present.segments.filter((s) => s.kind === 'fixed').length;
  const conflictCount = schedule.conflicts.length;

  const currentRow = schedule.rows.find(
    (r): r is ScheduledRow =>
      r.kind === 'segment' && playhead.offset >= r.startOffset && playhead.offset < r.endOffset,
  );

  return (
    <header className="topbar">
      <div className="brand">
        <span className="live-dot" aria-hidden />
        <div>
          <h1>{present.showName} · 导播流程单</h1>
          <div className="sub">
            开播{' '}
            {editingStart ? (
              <input
                className="inline"
                defaultValue={fmtClock(present.showStartSeconds)}
                autoFocus
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const p = parseClock(e.target.value);
                  if (p !== null) dispatch({ type: 'SET_SHOW_START', seconds: p });
                  setEditingStart(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditingStart(false);
                }}
              />
            ) : (
              <button className="clock-btn" title="点击修改开播时间" onClick={() => setEditingStart(true)}>
                {fmtClock(present.showStartSeconds)}
              </button>
            )}{' '}
            · 播出窗口 {fmtDur(present.slotDuration)}
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat
          label="当前总时长"
          tone={diff > 0 ? 'bad' : 'ok'}
          title={`计划 ${fmtDur(schedule.totalPlanned)} · 窗口 ${fmtDur(present.slotDuration)}`}
          value={
            <>
              {fmtDur(schedule.endOffset)}{' '}
              <span className={`chip ${diff > 0 ? 'bad' : diff < 0 ? 'warn' : 'ok'}`}>
                {diff === 0 ? '准点' : fmtSignedDur(diff)}
              </span>
            </>
          }
        />
        <Stat label="收尾时刻" value={fmtClock(present.showStartSeconds + schedule.endOffset)} />
        <Stat
          label="缓冲余量"
          tone={schedule.bufferRemaining > 0 ? 'ok' : 'bad'}
          title="所有缓冲段剩余时长之和"
          value={fmtDur(schedule.bufferRemaining)}
        />
        <Stat
          label="可消化余量"
          title="缓冲剩余 + 可压缩环节剩余可压量（固定点前还能吸收的超时）"
          value={fmtDur(schedule.absorbableRemaining)}
        />
        <Stat label="固定开播点" value={`${fixedCount} 个`} />
        <Stat
          label="冲突"
          tone={conflictCount > 0 ? 'bad' : 'ok'}
          value={conflictCount > 0 ? `${conflictCount} 处` : '无'}
        />
      </div>

      <div className="controls">
        <button className="btn" disabled={!canUndo} onClick={() => dispatch({ type: 'UNDO' })} title="撤销 (Ctrl/⌘+Z)">
          ↶ 撤销
        </button>
        <button className="btn" disabled={!canRedo} onClick={() => dispatch({ type: 'REDO' })} title="重做 (Ctrl/⌘+Shift+Z)">
          ↷ 重做
        </button>
        <button className="btn" onClick={() => dispatch({ type: 'RESET' })} title="恢复内置的 30 分钟节目单（可撤销）">
          ⟲ 重置
        </button>
        <span className="divider" />
        {playhead.playing ? (
          <button className="btn btn-primary" onClick={playhead.pause} title="空格">
            ⏸ 暂停
          </button>
        ) : (
          <button className="btn btn-primary" onClick={playhead.play} title="空格">
            ▶ 预演
          </button>
        )}
        <select
          className="btn speed"
          value={playhead.speed}
          onChange={(e) => playhead.setSpeed(Number(e.target.value))}
          title="预演倍速"
        >
          <option value={1}>1×</option>
          <option value={10}>10×</option>
          <option value={60}>60×</option>
          <option value={240}>240×</option>
        </select>
        <button className="btn" onClick={playhead.reset} title="播放头回到开播">
          ⏮
        </button>
        <span className="playhead-readout">
          {fmtClock(present.showStartSeconds + playhead.offset)}
          {currentRow ? ` · ${currentRow.segment.title} · 剩余 ${fmtDur(currentRow.endOffset - playhead.offset)}` : ''}
        </span>
      </div>
    </header>
  );
}
