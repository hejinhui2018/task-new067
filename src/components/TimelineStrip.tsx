import type { MouseEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import type { Playhead } from '../hooks/usePlayhead';

/** 可视化时间轴：按比例渲染各环节块、固定点、空档、冲突区与播放头，点击定位播放头 */
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

  return (
    <section className="panel strip-wrap">
      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} className="tick" style={{ left: pct(t) }}>
            {fmtClock(present.showStartSeconds + t)}
          </span>
        ))}
      </div>
      <div className="strip" onClick={seek} title="点击定位播放头">
        {schedule.rows.map((row) =>
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
              className={`block k-${row.segment.kind}`}
              style={{ left: pct(row.startOffset), width: pct(row.computedDuration) }}
            >
              <span className="block-label">
                {row.segment.kind === 'fixed' ? '⚓ ' : ''}
                {row.segment.title}
              </span>
            </div>
          ),
        )}
        {schedule.conflicts.map((c) => (
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
        <div className="playhead" style={{ left: pct(playhead.offset) }} />
      </div>
      <div className="legend">
        <span><i className="sw k-normal" />常规</span>
        <span><i className="sw k-compressible" />可压缩</span>
        <span><i className="sw k-buffer" />缓冲</span>
        <span><i className="sw k-fixed" />固定开播点</span>
        <span><i className="sw k-gap" />空档</span>
        <span><i className="sw k-conflict" />冲突</span>
        <span className="legend-hint">刻度为开播后的实际挂钟时间</span>
      </div>
    </section>
  );
}
