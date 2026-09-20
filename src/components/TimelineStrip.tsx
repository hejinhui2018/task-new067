import type { MouseEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import type { Playhead } from '../hooks/usePlayhead';

/**
 * 可视化时间轴：每个场地一条带，共享刻度尺与播放头；
 * 资源冲突在独立的冲突道上按区间标出，固定点冲突画在对应场地带内。
 */
export function TimelineStrip({ playhead }: { playhead: Playhead }) {
  const { present, schedule } = useRundown();
  const scale = Math.max(schedule.endOffset, present.slotDuration, 1);
  const pct = (off: number) => `${(off / scale) * 100}%`;

  const ticks: number[] = [];
  for (let t = 0; t <= scale; t += 300) ticks.push(t);

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    playhead.seek(((e.clientX - rect.left) / rect.width) * scale);
  };

  const executedValues = Object.values(present.executedUntil);
  const executedUntil = executedValues.length > 0 ? Math.max(...executedValues) : 0;

  return (
    <section className="panel strip-wrap">
      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} className="tick" style={{ left: pct(t) }}>
            {fmtClock(present.showStartSeconds + t)}
          </span>
        ))}
      </div>
      <div className="strips">
        {schedule.resourceConflicts.length > 0 && (
          <div className="strip-row">
            <span className="venue-tag res-tag">资源冲突</span>
            <div className="strip strip-res">
              {schedule.resourceConflicts.map((c) => (
                <div
                  key={c.id}
                  className="block k-resconflict"
                  style={{ left: pct(c.startOffset), width: pct(c.endOffset - c.startOffset) }}
                  title={c.usages.map((u) => `${u.venueName}·${u.title}`).join(' ↔ ')}
                >
                  <span className="block-label">
                    {c.resource} +{fmtDur(c.endOffset - c.startOffset)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {schedule.venues.map((v) => (
          <div className="strip-row" key={v.venue.id}>
            <span className="venue-tag">{v.venue.name}</span>
            <div className="strip" onClick={seek} title="点击定位播放头">
              {executedUntil > 0 && (
                <div
                  className="executed-shade"
                  style={{ left: 0, width: pct(executedUntil) }}
                  title={`已执行至 ${fmtClock(present.showStartSeconds + executedUntil)}`}
                />
              )}
              {v.result.rows.map((row) =>
                row.kind === 'gap' ? (
                  <div
                    key={row.id}
                    className="block k-gap"
                    style={{ left: pct(row.startOffset), width: pct(row.duration) }}
                  >
                    <span className="block-label">空档 {fmtDur(row.duration)}</span>
                  </div>
                ) : (
                  <div
                    key={row.segment.id}
                    className={`block k-${row.segment.kind}${v.lockedIds.has(row.segment.id) ? ' k-locked' : ''}`}
                    style={{ left: pct(row.startOffset), width: pct(row.computedDuration) }}
                  >
                    <span className="block-label">
                      {row.segment.kind === 'fixed' ? '⚓ ' : ''}
                      {v.lockedIds.has(row.segment.id) ? '🔒 ' : ''}
                      {row.segment.title}
                    </span>
                  </div>
                ),
              )}
              {v.result.conflicts.map((c) => (
                <div
                  key={c.fixedSegmentId}
                  className="block k-conflict"
                  style={{ left: pct(c.fixedStartOffset), width: pct(c.overBy) }}
                >
                  <span className="block-label">冲突 +{fmtDur(c.overBy)}</span>
                </div>
              ))}
              <div className="slot-marker" style={{ left: pct(present.slotDuration) }}>
                <span>窗口 {fmtDur(present.slotDuration)}</span>
              </div>
            </div>
          </div>
        ))}
        <div
          className="playhead"
          style={{ left: `calc(72px + (100% - 72px) * ${Math.min(1, playhead.offset / scale)})` }}
        />
      </div>
      <div className="legend">
        <span><i className="sw k-normal" />常规</span>
        <span><i className="sw k-compressible" />可压缩</span>
        <span><i className="sw k-buffer" />缓冲</span>
        <span><i className="sw k-fixed" />固定开播点</span>
        <span><i className="sw k-gap" />空档</span>
        <span><i className="sw k-conflict" />固定点冲突</span>
        <span><i className="sw k-resconflict" />资源冲突</span>
        <span className="legend-hint">刻度为开播后的实际挂钟时间；两条带共用同一时刻轴</span>
      </div>
    </section>
  );
}
