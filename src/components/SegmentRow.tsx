import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ScheduledRow } from '../engine/schedule';
import { fmtClock, fmtDur, parseClock, parseDuration } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import type { SegmentKind } from '../types';

interface Props {
  venueId: string;
  row: ScheduledRow;
  segIndex: number;
  showStartSeconds: number;
  isCurrent: boolean;
  isConflict: boolean;
  isResourceConflict: boolean;
  isLocked: boolean;
  dropBefore: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, segIndex: number) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function SegmentRowView(props: Props) {
  const {
    venueId,
    row,
    segIndex,
    showStartSeconds,
    isCurrent,
    isConflict,
    isResourceConflict,
    isLocked,
    dropBefore,
    dragging,
  } = props;
  const { dispatch } = useRundown();
  const seg = row.segment;

  const [editingDur, setEditingDur] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingFixed, setEditingFixed] = useState(false);
  const [editingResources, setEditingResources] = useState(false);
  const [dragEnabled, setDragEnabled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isCurrent) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  const compressed = row.compressedBy > 0;

  const commitDuration = (text: string) => {
    const parsed = parseDuration(text);
    if (parsed !== null) dispatch({ type: 'UPDATE_DURATION', venueId, id: seg.id, duration: parsed });
    setEditingDur(false);
  };

  const commitTitle = (text: string) => {
    dispatch({ type: 'UPDATE_TITLE', venueId, id: seg.id, title: text });
    setEditingTitle(false);
  };

  const commitFixedStart = (text: string) => {
    const parsed = parseClock(text);
    if (parsed !== null) {
      dispatch({
        type: 'UPDATE_FIXED_START',
        venueId,
        id: seg.id,
        offset: Math.max(0, parsed - showStartSeconds),
      });
    }
    setEditingFixed(false);
  };

  const commitResources = (text: string) => {
    dispatch({
      type: 'UPDATE_RESOURCES',
      venueId,
      id: seg.id,
      resources: text.split(/[,，、]/),
    });
    setEditingResources(false);
  };

  const className = [
    'row',
    'seg-row',
    `k-${seg.kind}`,
    isCurrent ? 'row-current' : '',
    isConflict ? 'row-conflict' : '',
    isResourceConflict ? 'row-res-conflict' : '',
    isLocked ? 'row-locked' : '',
    dropBefore ? 'drop-before' : '',
    dragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      draggable={dragEnabled && !isLocked}
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
        title={isLocked ? '已执行锁定，不可拖动' : '拖动排序 / 拖到另一场地'}
        onMouseDown={() => !isLocked && setDragEnabled(true)}
        onMouseUp={() => setDragEnabled(false)}
      >
        {isLocked ? '🔒' : '⠿'}
      </span>
      <span className="mono muted">{segIndex + 1}</span>

      <span className="cell-title">
        <select
          className={`badge k-${seg.kind}`}
          value={seg.kind}
          disabled={seg.kind === 'fixed' || isLocked}
          title={seg.kind === 'fixed' ? '固定环节（用 ⚓ 取消固定）' : isLocked ? '已执行锁定' : '环节类型'}
          onChange={(e) =>
            dispatch({
              type: 'CHANGE_KIND',
              venueId,
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
        {editingTitle && !isLocked ? (
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
          <span
            className="seg-title"
            onDoubleClick={() => !isLocked && setEditingTitle(true)}
            title={isLocked ? '已执行锁定' : '双击改名'}
          >
            {seg.title}
          </span>
        )}
        {seg.kind === 'fixed' &&
          (editingFixed && !isLocked ? (
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
              title={isLocked ? '已执行锁定' : '固定开播点，点击修改（HH:MM）'}
              onClick={() => !isLocked && setEditingFixed(true)}
            >
              ⚓ {fmtClock(showStartSeconds + (seg.fixedStartOffset ?? 0))}
            </button>
          ))}
        {editingResources && !isLocked ? (
          <input
            className="inline res-input"
            defaultValue={seg.resources.join(',')}
            placeholder="资源，逗号分隔"
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitResources(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingResources(false);
            }}
          />
        ) : (
          seg.resources.length > 0 && (
            <span className="res-chips" title="占用的共享资源（跨场地统一校验）">
              {seg.resources.map((r) => (
                <span key={r} className={`res-chip${isResourceConflict ? ' res-conflict' : ''}`}>
                  {r}
                </span>
              ))}
            </span>
          )
        )}
      </span>

      <span className="mono">{fmtClock(showStartSeconds + row.startOffset)}</span>
      <span className="mono">{fmtClock(showStartSeconds + row.endOffset)}</span>

      <span className="cell-dur">
        {editingDur && !isLocked ? (
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
            title={isLocked ? '已执行锁定' : '点击修改时长（如 6:00 或 6，单位分钟）'}
            disabled={isLocked}
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
        {!isLocked && (
          <span className="bump">
            <button
              className="icon-btn"
              title="减少 30 秒"
              onClick={() => dispatch({ type: 'UPDATE_DURATION', venueId, id: seg.id, duration: seg.duration - 30 })}
            >
              −
            </button>
            <button
              className="icon-btn"
              title="增加 30 秒"
              onClick={() => dispatch({ type: 'UPDATE_DURATION', venueId, id: seg.id, duration: seg.duration + 30 })}
            >
              ＋
            </button>
          </span>
        )}
      </span>

      <span className="cell-status">
        {isLocked && <span className="muted">已执行</span>}
        {!isLocked && seg.kind === 'compressible' && (
          <span className={compressed ? 'warn-text' : 'muted'}>
            可压至 {fmtDur(seg.minDuration)}
            {compressed && ` · 已压 ${fmtDur(row.compressedBy)}`}
          </span>
        )}
        {!isLocked && seg.kind === 'buffer' &&
          (row.computedDuration > 0 ? (
            <span className="ok-text">余 {fmtDur(row.computedDuration)}</span>
          ) : (
            <span className="bad-text">已耗尽</span>
          ))}
        {!isLocked && seg.kind === 'normal' && <span className="muted">整体顺延</span>}
        {!isLocked && seg.kind === 'fixed' &&
          (isConflict ? (
            <span className="bad-text">固定点冲突</span>
          ) : (
            <span className="ok-text">准点锁定</span>
          ))}
        {isResourceConflict && <span className="bad-text"> · 资源冲突</span>}
      </span>

      <span className="cell-actions">
        <button
          className="icon-btn"
          title={isLocked ? '已执行锁定' : seg.kind === 'fixed' ? '取消固定' : '设为固定开播点（锁定当前开始时间）'}
          disabled={isLocked}
          onClick={() => dispatch({ type: 'TOGGLE_FIXED', venueId, id: seg.id })}
        >
          {seg.kind === 'fixed' ? '⚓' : '📌'}
        </button>
        <button
          className="icon-btn"
          title={isLocked ? '已执行锁定' : '编辑共享资源（逗号分隔）'}
          disabled={isLocked}
          onClick={() => setEditingResources(true)}
        >
          🏷
        </button>
        <button className="icon-btn" title="改名" disabled={isLocked} onClick={() => setEditingTitle(true)}>
          ✎
        </button>
        <button
          className="icon-btn"
          title="在其后插入新环节"
          onClick={() =>
            dispatch({
              type: 'INSERT_AT',
              venueId,
              index: segIndex + 1,
              segment: { id: uid(), title: '新环节', kind: 'normal', duration: 120, minDuration: 0, resources: [] },
            })
          }
        >
          ＋
        </button>
        <button
          className="icon-btn danger"
          title={isLocked ? '已执行锁定，不可删除' : '删除（可撤销）'}
          disabled={isLocked}
          onClick={() => dispatch({ type: 'DELETE', venueId, id: seg.id })}
        >
          🗑
        </button>
      </span>
    </div>
  );
}
