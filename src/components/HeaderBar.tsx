import { useState } from 'react';
import { fmtClock, fmtDur, fmtSignedDur, parseClock } from '../engine/time';
import type { ScheduledRow } from '../engine/schedule';
import { useRundown } from '../store/RundownContext';
import type { Playhead } from '../hooks/usePlayhead';
import type { VenueId } from '../types';

function Stat({ label, value, tone, title }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'bad'; title?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`} title={title}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

const VENUE_TAG: Record<VenueId, string> = { A: '主', B: '访' };

export function HeaderBar({ playhead }: { playhead: Playhead }) {
  const { present, show, dispatch, canUndo, canRedo } = useRundown();
  const [editingStart, setEditingStart] = useState(false);

  const diff = show.endOffset - present.slotDuration;
  const fixedCount = present.segments.filter((s) => s.kind === 'fixed').length;
  const conflictCount = show.fixedConflicts.length + show.resourceConflicts.length;

  // 播放头当前所在环节（可能同时命中两个场地）
  const current: Array<{ venueId: VenueId; row: ScheduledRow }> = [];
  for (const vs of show.venues) {
    const row = vs.schedule.rows.find(
      (r): r is ScheduledRow =>
        r.kind === 'segment' && playhead.offset >= r.startOffset && playhead.offset < r.endOffset,
    );
    if (row) current.push({ venueId: vs.venueId, row });
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="live-dot" aria-hidden />
        <div>
          <h1>{present.showName} · 双场地联排</h1>
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
            · 播出窗口 {fmtDur(present.slotDuration)} · 主舞台 / 访谈间 两条时间线独立调整，共享资源统一校验
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat
          label="最晚收尾"
          tone={diff > 0 ? 'bad' : 'ok'}
          title={`计划最长 ${fmtDur(show.totalPlanned)} · 窗口 ${fmtDur(present.slotDuration)}`}
          value={
            <>
              {fmtDur(show.endOffset)}{' '}
              <span className={`chip ${diff > 0 ? 'bad' : diff < 0 ? 'warn' : 'ok'}`}>
                {diff === 0 ? '准点' : fmtSignedDur(diff)}
              </span>
            </>
          }
        />
        <Stat label="收尾时刻" value={fmtClock(present.showStartSeconds + show.endOffset)} />
        <Stat
          label="缓冲余量"
          tone={show.bufferRemaining > 0 ? 'ok' : 'bad'}
          title="两场地所有缓冲段剩余时长之和"
          value={fmtDur(show.bufferRemaining)}
        />
        <Stat
          label="可消化余量"
          title="两场地缓冲剩余 + 可压缩环节剩余可压量"
          value={fmtDur(show.absorbableRemaining)}
        />
        <Stat label="固定开播点" value={`${fixedCount} 个`} />
        <Stat label="已执行锁定" value={`${show.lockedCount} 段`} />
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
        <button className="btn" onClick={() => dispatch({ type: 'RESET' })} title="恢复双场地示例节目单（可撤销）">
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
          {current.length > 0 &&
            ` · ${current.map((c) => `${VENUE_TAG[c.venueId]} ${c.row.segment.title}`).join(' / ')}`}
        </span>
      </div>
    </header>
  );
}
