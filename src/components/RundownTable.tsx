import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import type { GapRow, VenueSchedule } from '../engine/schedule';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import { SegmentRowView } from './SegmentRow';

function newSegment() {
  return { id: uid(), title: '新环节', kind: 'normal' as const, duration: 120, minDuration: 0, resources: [] };
}

interface DragSource {
  venueId: string;
  index: number;
}

interface DropGap {
  venueId: string;
  index: number;
}

/** 双场地流程单：每个场地一张表，环节可在本场地排序，也可拖到另一场地 */
export function RundownTable({ playheadOffset }: { playheadOffset: number }) {
  const { present, schedule, dispatch } = useRundown();
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropGap, setDropGap] = useState<DropGap | null>(null);

  const resourceConflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of schedule.resourceConflicts) {
      for (const u of c.usages) set.add(u.segmentId);
    }
    return set;
  }, [schedule.resourceConflicts]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragSource && dropGap) {
      if (dragSource.venueId === dropGap.venueId) {
        dispatch({ type: 'REORDER', venueId: dragSource.venueId, from: dragSource.index, to: dropGap.index });
      } else {
        const segmentId = present.venues.find((v) => v.id === dragSource.venueId)?.segments[
          dragSource.index
        ]?.id;
        if (segmentId) {
          dispatch({
            type: 'MOVE_BETWEEN_VENUES',
            segmentId,
            fromVenueId: dragSource.venueId,
            toVenueId: dropGap.venueId,
            index: dropGap.index,
          });
        }
      }
    }
    setDragSource(null);
    setDropGap(null);
  };

  const onDragEnd = () => {
    setDragSource(null);
    setDropGap(null);
  };

  return (
    <>
      {schedule.venues.map((vs) => (
        <VenueTable
          key={vs.venue.id}
          vs={vs}
          playheadOffset={playheadOffset}
          showStartSeconds={present.showStartSeconds}
          resourceConflictIds={resourceConflictIds}
          dragSource={dragSource}
          dropGap={dropGap}
          setDragSource={setDragSource}
          setDropGap={setDropGap}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
}

function VenueTable({
  vs,
  playheadOffset,
  showStartSeconds,
  resourceConflictIds,
  dragSource,
  dropGap,
  setDragSource,
  setDropGap,
  onDrop,
  onDragEnd,
}: {
  vs: VenueSchedule;
  playheadOffset: number;
  showStartSeconds: number;
  resourceConflictIds: Set<string>;
  dragSource: DragSource | null;
  dropGap: DropGap | null;
  setDragSource: (s: DragSource | null) => void;
  setDropGap: (g: DropGap | null) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { dispatch } = useRundown();
  const venue = vs.venue;
  const venueId = venue.id;

  const indexById = useMemo(
    () => new Map(venue.segments.map((s, i) => [s.id, i] as const)),
    [venue.segments],
  );
  const fixedConflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of vs.result.conflicts) {
      set.add(c.fixedSegmentId);
      for (const id of c.overflowingSegmentIds) set.add(id);
    }
    return set;
  }, [vs.result.conflicts]);

  const onRowDragOver = (e: DragEvent<HTMLDivElement>, segIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropGap({ venueId, index: e.clientY < rect.top + rect.height / 2 ? segIndex : segIndex + 1 });
  };

  const gapHere = (index: number) => dropGap?.venueId === venueId && dropGap.index === index;

  return (
    <section className="panel table-wrap">
      <div className="venue-head">
        <h2>{venue.name}</h2>
        <span className="muted">
          收尾 {fmtClock(showStartSeconds + vs.result.endOffset)} · {venue.segments.length} 个环节
          {vs.lockedIds.size > 0 && ` · 🔒 已执行 ${vs.lockedIds.size} 个`}
        </span>
      </div>
      <div className="row row-head">
        <span />
        <span>#</span>
        <span>环节</span>
        <span>开始</span>
        <span>结束</span>
        <span>时长（计划 → 实际）</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      {vs.result.rows.map((row) => {
        if (row.kind === 'gap') {
          const at = indexById.get(row.beforeFixedSegmentId) ?? venue.segments.length;
          return (
            <GapRowView
              key={row.id}
              row={row}
              showStartSeconds={showStartSeconds}
              onInsert={() =>
                dispatch({ type: 'INSERT_AT', venueId, index: at, segment: newSegment() })
              }
            />
          );
        }
        const segIndex = indexById.get(row.segment.id) ?? 0;
        return (
          <SegmentRowView
            key={row.segment.id}
            venueId={venueId}
            row={row}
            segIndex={segIndex}
            showStartSeconds={showStartSeconds}
            isCurrent={playheadOffset >= row.startOffset && playheadOffset < row.endOffset}
            isConflict={fixedConflictIds.has(row.segment.id)}
            isResourceConflict={resourceConflictIds.has(row.segment.id)}
            isLocked={vs.lockedIds.has(row.segment.id)}
            dropBefore={gapHere(segIndex)}
            dragging={dragSource?.venueId === venueId && dragSource.index === segIndex}
            onDragStart={() => setDragSource({ venueId, index: segIndex })}
            onDragOver={onRowDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        );
      })}
      <div
        className={`drop-tail ${gapHere(venue.segments.length) ? 'drop-before' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropGap({ venueId, index: venue.segments.length });
        }}
        onDrop={onDrop}
      >
        <button
          className="btn"
          onClick={() =>
            dispatch({ type: 'INSERT_AT', venueId, index: venue.segments.length, segment: newSegment() })
          }
        >
          ＋ 添加环节
        </button>
      </div>
    </section>
  );
}

function GapRowView({
  row,
  showStartSeconds,
  onInsert,
}: {
  row: GapRow;
  showStartSeconds: number;
  onInsert: () => void;
}) {
  return (
    <div className="row row-gap">
      <span />
      <span />
      <span className="gap-label">⋯ 空档 {fmtDur(row.duration)}（固定点前的等待，可插入内容）</span>
      <span className="mono">{fmtClock(showStartSeconds + row.startOffset)}</span>
      <span className="mono">{fmtClock(showStartSeconds + row.endOffset)}</span>
      <span className="mono muted">{fmtDur(row.duration)}</span>
      <span className="muted">—</span>
      <span>
        <button className="icon-btn" title="在此空档插入新环节" onClick={onInsert}>
          ＋
        </button>
      </span>
    </div>
  );
}
