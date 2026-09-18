import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ScheduledRow } from '../engine/schedule';
import { fmtClock, fmtDur, parseClock, parseDuration } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import type { SegmentKind } from '../types';

interface Props {
  row: ScheduledRow;
  segIndex: number;
  showStartSeconds: number;
  isCurrent: boolean;
  isConflict: boolean;
  dropBefore: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, segIndex: number) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function SegmentRowView(props: Props) {
  const { row, segIndex, showStartSeconds, isCurrent, isConflict, dropBefore, dragging } = props;
  const { dispatch } = useRundown();
  const seg = row.segment;

  const [editingDur, setEditingDur] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingFixed, setEditingFixed] = useState(false);
  const [dragEnabled, setDragEnabled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCurrent) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  const compressed = row.compressedBy > 0;

  const commitDuration = (text: string) => {
    const parsed = parseDuration(text);
    if (parsed !== null) dispatch({ type: 'UPDATE_DURATION', id: seg.id, duration: parsed });
    setEditingDur(false);
  };

  const commitTitle = (text: string) => {
    dispatch({ type: 'UPDATE_TITLE', id: seg.id, title: text });
    setEditingTitle(false);
  };

  const commitFixedStart = (text: string) => {
    const parsed = parseClock(text);
    if (parsed !== null) {
      dispatch({
        type: 'UPDATE_FIXED_START',
        id: seg.id,
        offset: Math.max(0, parsed - showStartSeconds),
      });
    }
    setEditingFixed(false);
  };

  const className = [
    'row',
    'seg-row',
    `k-${seg.kind}`,
    isCurrent ? 'row-current' : '',
    isConflict ? 'row-conflict' : '',
    dropBefore ? 'drop-before' : '',
    dragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      draggable={dragEnabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart();
      }}
      onDragOver={(e) => props.onDragOver(e, segIndex)}
      onDrop={props.onDrop}
      onDragEnd={() => {
        setDragEnabled(false);
        props.onDragEnd();
      }}
    >
      <span
        className="grip"
        title="拖动排序"
        onMouseDown={() => setDragEnabled(true)}
        onMouseUp={() => setDragEnabled(false)}
      >
        ⠿
      </span>
      <span className="mono muted">{segIndex + 1}</span>

      <span className="cell-title">
        <select
          className={`badge k-${seg.kind}`}
          value={seg.kind}
          disabled={seg.kind === 'fixed'}
          title={seg.kind === 'fixed' ? '固定环节（用 ⚓ 取消固定）' : '环节类型'}
          onChange={(e) =>
            dispatch({
              type: 'CHANGE_KIND',
              id: seg.id,
              kind: e.target.value as Exclude<SegmentKind, 'fixed'>,
            })
          }
        >
          <option value="normal">常规</option>
          <option value="compressible">可压缩</option>
          <option value="buffer">缓冲</option>
          {seg.kind === 'fixed' && <option value="fixed">固定</option>}
        </select>
        {editingTitle ? (
          <input
            className="inline title-input"
            defaultValue={seg.title}
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
          />
        ) : (
          <span className="seg-title" onDoubleClick={() => setEditingTitle(true)} title="双击改名">
            {seg.title}
          </span>
        )}
        {seg.kind === 'fixed' &&
          (editingFixed ? (
            <input
              className="inline fixed-input"
              defaultValue={fmtClock(showStartSeconds + (seg.fixedStartOffset ?? 0))}
              autoFocus
              onFocus={(e) => e.target.select()}
              onBlur={(e) => commitFixedStart(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditingFixed(false);
              }}
            />
          ) : (
            <button
              className="fixed-chip"
              title="固定开播点，点击修改（HH:MM）"
              onClick={() => setEditingFixed(true)}
            >
              ⚓ {fmtClock(showStartSeconds + (seg.fixedStartOffset ?? 0))}
            </button>
          ))}
      </span>

      <span className="mono">{fmtClock(showStartSeconds + row.startOffset)}</span>
      <span className="mono">{fmtClock(showStartSeconds + row.endOffset)}</span>

      <span className="cell-dur">
        {editingDur ? (
          <input
            className="inline dur-input"
            defaultValue={fmtDur(seg.duration)}
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitDuration(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingDur(false);
            }}
          />
        ) : (
          <button
            className="dur-chip mono"
            title="点击修改时长（如 6:00 或 6，单位分钟）"
            onClick={() => setEditingDur(true)}
          >
            {fmtDur(seg.duration)}
          </button>
        )}
        {compressed && (
          <span className="compressed mono" title={`为保住固定点被压缩 ${fmtDur(row.compressedBy)}`}>
            → {fmtDur(row.computedDuration)}
          </span>
        )}
        <span className="bump">
          <button
            className="icon-btn"
            title="减少 30 秒"
            onClick={() => dispatch({ type: 'UPDATE_DURATION', id: seg.id, duration: seg.duration - 30 })}
          >
            −
          </button>
          <button
            className="icon-btn"
            title="增加 30 秒"
            onClick={() => dispatch({ type: 'UPDATE_DURATION', id: seg.id, duration: seg.duration + 30 })}
          >
            ＋
          </button>
        </span>
      </span>

      <span className="cell-status">
        {seg.kind === 'compressible' && (
          <span className={compressed ? 'warn-text' : 'muted'}>
            可压至 {fmtDur(seg.minDuration)}
            {compressed && ` · 已压 ${fmtDur(row.compressedBy)}`}
          </span>
        )}
        {seg.kind === 'buffer' &&
          (row.computedDuration > 0 ? (
            <span className="ok-text">余 {fmtDur(row.computedDuration)}</span>
          ) : (
            <span className="bad-text">已耗尽</span>
          ))}
        {seg.kind === 'normal' && <span className="muted">整体顺延</span>}
        {seg.kind === 'fixed' &&
          (isConflict ? (
            <span className="bad-text">固定点冲突</span>
          ) : (
            <span className="ok-text">准点锁定</span>
          ))}
      </span>

      <span className="cell-actions">
        <button
          className="icon-btn"
          title={seg.kind === 'fixed' ? '取消固定' : '设为固定开播点（锁定当前开始时间）'}
          onClick={() => dispatch({ type: 'TOGGLE_FIXED', id: seg.id })}
        >
          {seg.kind === 'fixed' ? '⚓' : '📌'}
        </button>
        <button className="icon-btn" title="改名" onClick={() => setEditingTitle(true)}>
          ✎
        </button>
        <button
          className="icon-btn"
          title="在其后插入新环节"
          onClick={() =>
            dispatch({
              type: 'INSERT_AT',
              index: segIndex + 1,
              segment: { id: uid(), title: '新环节', kind: 'normal', duration: 120, minDuration: 0 },
            })
          }
        >
          ＋
        </button>
        <button
          className="icon-btn danger"
          title="删除（可撤销）"
          onClick={() => dispatch({ type: 'DELETE', id: seg.id })}
        >
          🗑
        </button>
      </span>
    </div>
  );
}
