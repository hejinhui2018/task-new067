import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { fmtClock, fmtDur } from '../engine/time';
import type { GapRow } from '../engine/schedule';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import { SegmentRowView } from './SegmentRow';

function newSegment() {
  return { id: uid(), title: '新环节', kind: 'normal' as const, duration: 120, minDuration: 0 };
}

export function RundownTable({ playheadOffset }: { playheadOffset: number }) {
  const { present, schedule, dispatch } = useRundown();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);

  const indexById = useMemo(
    () => new Map(present.segments.map((s, i) => [s.id, i] as const)),
    [present.segments],
  );
  const conflictIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of schedule.conflicts) {
      set.add(c.fixedSegmentId);
      for (const id of c.overflowingSegmentIds) set.add(id);
    }
    return set;
  }, [schedule.conflicts]);

  const onRowDragOver = (e: DragEvent<HTMLDivElement>, segIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropGap(e.clientY < rect.top + rect.height / 2 ? segIndex : segIndex + 1);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragIndex !== null && dropGap !== null) {
      dispatch({ type: 'REORDER', from: dragIndex, to: dropGap });
    }
    setDragIndex(null);
    setDropGap(null);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setDropGap(null);
  };

  return (
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
          const at = indexById.get(row.beforeFixedSegmentId) ?? present.segments.length;
          return (
            <GapRowView
              key={row.id}
              row={row}
              showStartSeconds={present.showStartSeconds}
              onInsert={() => dispatch({ type: 'INSERT_AT', index: at, segment: newSegment() })}
            />
          );
        }
        const segIndex = indexById.get(row.segment.id) ?? 0;
        return (
          <SegmentRowView
            key={row.segment.id}
            row={row}
            segIndex={segIndex}
            showStartSeconds={present.showStartSeconds}
            isCurrent={playheadOffset >= row.startOffset && playheadOffset < row.endOffset}
            isConflict={conflictIds.has(row.segment.id)}
            dropBefore={dropGap === segIndex}
            dragging={dragIndex === segIndex}
            onDragStart={() => setDragIndex(segIndex)}
            onDragOver={onRowDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        );
      })}
      <div
        className={`drop-tail ${dropGap === present.segments.length ? 'drop-before' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropGap(present.segments.length);
        }}
        onDrop={onDrop}
      >
        <button
          className="btn"
          onClick={() => dispatch({ type: 'INSERT_AT', index: present.segments.length, segment: newSegment() })}
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
