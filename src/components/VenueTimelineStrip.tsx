import { useState } from 'react';
import type { MouseEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import type { Playhead } from '../hooks/usePlayhead';
import type { VenueId } from '../types';

/**
 * 单场地时间轴：按比例渲染本场地环节块、固定点、空档、冲突区与全局播放头。
 * 块下方色条表示该环节占用的共享资源；红色描边表示该块正卷入跨场地碰撞。
 */
export function VenueTimelineStrip({
  venueId,
  playhead,
}: {
  venueId: VenueId;
  playhead: Playhead;
}) {
  const { present, show } = useRundown();
  const vs = show.byVenue.get(venueId)!;
  const { schedule } = vs;
  const scale = Math.max(schedule.endOffset, present.slotDuration, 1);
  const pct = (off: number) => `${(off / scale) * 100}%`;

  const [hover, setHover] = useState<number | null>(null);

  const ticks: number[] = [];
  for (let t = 0; t <= scale; t += 300) ticks.push(t);

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    playhead.seek(((e.clientX - rect.left) / rect.width) * scale);
  };

  const collisionIds = new Set<string>();
  for (const c of show.resourceConflicts) {
    for (const p of c.parties) if (p.venueId === venueId) collisionIds.add(p.segmentId);
  }
  const resources = present.resources ?? [];
  const resColor = new Map(resources.map((r, i) => [r.id, RES_COLORS[i % RES_COLORS.length]]));

  return (
    <section className={`panel strip-wrap venue-${venueId}`}>
      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} className="tick" style={{ left: pct(t) }}>
            {fmtClock(present.showStartSeconds + t)}
          </span>
        ))}
      </div>
      <div
        className="strip"
        onClick={seek}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - rect.left) / rect.width) * scale);
        }}
        onMouseLeave={() => setHover(null)}
        title="点击定位播放头"
      >
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
              className={`block k-${row.segment.kind} ${row.locked ? 'is-locked' : ''} ${
                collisionIds.has(row.segment.id) ? 'block-collision' : ''
              }`}
              style={{ left: pct(row.startOffset), width: pct(row.computedDuration) }}
            >
              <span className="block-label">
                {row.segment.kind === 'fixed' ? '⚓ ' : ''}
                {row.locked ? '🔒 ' : ''}
                {row.segment.title}
              </span>
              <span className="block-resources">
                {(row.segment.resourceIds ?? []).map((rid) => (
                  <i
                    key={rid}
                    className="res-dot"
                    style={{ background: resColor.get(rid) ?? '#888' }}
                    title={resources.find((r) => r.id === rid)?.name ?? rid}
                  />
                ))}
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
        {hover !== null && (
          <div className="hover-clock mono" style={{ left: pct(hover) }}>
            {fmtClock(present.showStartSeconds + hover)}
          </div>
        )}
      </div>
    </section>
  );
}

const RES_COLORS = ['#ff8a5c', '#c77dff', '#4dd0e1', '#ffd166', '#8ce99a', '#ff6b9d'];
