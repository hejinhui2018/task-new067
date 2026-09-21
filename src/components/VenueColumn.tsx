import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import type { GapRow } from '../engine/schedule';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import type { Playhead } from '../hooks/usePlayhead';
import type { VenueId } from '../types';
import { VenueTimelineStrip } from './VenueTimelineStrip';
import { SegmentRowView, DND_MIME } from './SegmentRow';
import type { DndPayload } from './SegmentRow';

function newSegment(venue: VenueId) {
  return {
    id: uid(),
    title: '新环节',
    venue,
    kind: 'normal' as const,
    duration: 120,
    minDuration: 0,
    resourceIds: [],
  };
}

/**
 * 单场地列：场地标题栏 + 时间轴 + 流程单表格。
 * 拖放既支持同场地排序（REORDER_VENUE），也支持跨场地搬运（MOVE_VENUE）。
 * 放置位置只能落在该场地已执行锁定前缀之后。
 */
export function VenueColumn({ venueId, playhead }: { venueId: VenueId; playhead: Playhead }) {
  const { present, show, dispatch } = useRundown();
  const vs = show.byVenue.get(venueId)!;
  const { schedule } = vs;

  const [drag, setDrag] = useState<DndPayload | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);

  const venueSegs = useMemo(
    () => present.segments.filter((s) => (s.venue ?? 'A') === venueId),
    [present.segments, venueId],
  );
  const indexById = useMemo(() => new Map(venueSegs.map((s, i) => [s.id, i] as const)), [venueSegs]);

  const lockedLen = useMemo(() => {
    const i = venueSegs.findIndex((s) => !s.locked);
    return i === -1 ? venueSegs.length : i;
  }, [venueSegs]);

  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of schedule.conflicts) {
      set.add(c.fixedSegmentId);
      for (const id of c.overflowingSegmentIds) set.add(id);
    }
    for (const rc of show.resourceConflicts) {
      for (const p of rc.parties) if (p.venueId === venueId) set.add(p.segmentId);
    }
    return set;
  }, [schedule.conflicts, show.resourceConflicts, venueId]);

  const onRowDragOver = (e: DragEvent<HTMLDivElement>, segIndex: number) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag && drag.fromVenue !== venueId ? 'copy' : 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropGap(e.clientY < rect.top + rect.height / 2 ? segIndex : segIndex + 1);
  };

  const onColumnDragOver = (e: DragEvent) => {
    // 空场地 / 尾部落点也要允许放置
    if (e.dataTransfer.types.includes(DND_MIME)) e.preventDefault();
  };

  const readPayload = (e: DragEvent): DndPayload | null => {
    if (drag) return drag; // 本列拖动
    try {
      const raw = e.dataTransfer.getData(DND_MIME);
      return raw ? (JSON.parse(raw) as DndPayload) : null;
    } catch {
      return null;
    }
  };

  const dispatchDrop = (payload: DndPayload, gap: number) => {
    if (payload.fromVenue === venueId) {
      dispatch({ type: 'REORDER_VENUE', venue: venueId, from: payload.fromIndex, to: gap });
    } else {
      dispatch({ type: 'MOVE_VENUE', id: payload.id, toVenue: venueId, toIndex: gap });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const payload = readPayload(e);
    if (payload && dropGap !== null) dispatchDrop(payload, dropGap);
    setDrag(null);
    setDropGap(null);
  };

  const onDragEnd = () => {
    setDrag(null);
    setDropGap(null);
  };

  return (
    <div className={`venue-col venue-col-${venueId}`} onDragOver={onColumnDragOver}>
      <div className="venue-head">
        <span className={`venue-badge vd-${venueId}`}>{venueId === 'A' ? '主舞台' : '访谈间'}</span>
        <span className="muted">{vs.name} · {venueSegs.length} 个环节</span>
        <span className="venue-head-spacer" />
        {vs.lockedCount > 0 && (
          <button
            className="btn btn-small"
            title="解除本场地已执行锁定（可撤销）"
            onClick={() => dispatch({ type: 'UNLOCK_VENUE', venue: venueId })}
          >
            🔓 解锁前缀（{vs.lockedCount}）
          </button>
        )}
        <button
          className="btn btn-small"
          onClick={() => dispatch({ type: 'INSERT_IN_VENUE', venue: venueId, index: venueSegs.length, segment: newSegment(venueId) })}
        >
          ＋ 添加环节
        </button>
      </div>

      <VenueTimelineStrip venueId={venueId} playhead={playhead} />

      <section className="panel table-wrap">
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
        {schedule.rows.map((row) => {
          if (row.kind === 'gap') {
            const at = Math.max(indexById.get(row.beforeFixedSegmentId) ?? venueSegs.length, lockedLen);
            return (
              <GapRowView
                key={row.id}
                row={row}
                showStartSeconds={present.showStartSeconds}
                onInsert={() =>
                  dispatch({ type: 'INSERT_IN_VENUE', venue: venueId, index: at, segment: newSegment(venueId) })
                }
              />
            );
          }
          const segIndex = indexById.get(row.segment.id) ?? 0;
          return (
            <SegmentRowView
              key={row.segment.id}
              row={row}
              segIndex={segIndex}
              venueId={venueId}
              showStartSeconds={present.showStartSeconds}
              isCurrent={playhead.offset >= row.startOffset && playhead.offset < row.endOffset}
              isConflict={conflictIds.has(row.segment.id)}
              isLocked={!!row.locked}
              dropBefore={dropGap === segIndex}
              dragging={drag?.id === row.segment.id}
              onDragStart={() => setDrag({ id: row.segment.id, fromVenue: venueId, fromIndex: segIndex })}
              onDragOver={onRowDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          );
        })}
        <div
          className={`drop-tail ${dropGap === venueSegs.length ? 'drop-before' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropGap(venueSegs.length);
          }}
          onDrop={onDrop}
        >
          <button
            className="btn"
            onClick={() =>
              dispatch({ type: 'INSERT_IN_VENUE', venue: venueId, index: venueSegs.length, segment: newSegment(venueId) })
            }
          >
            ＋ 添加环节（拖到此处可跨场地搬运）
          </button>
        </div>
      </section>
    </div>
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
