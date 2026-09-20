import type { Segment, Venue } from '../types';

/** 已排程的环节行：startOffset/endOffset 为距开播的秒数 */
export interface ScheduledRow {
  kind: 'segment';
  segment: Segment;
  startOffset: number;
  endOffset: number;
  /** 用户设定的计划时长（秒），永不被引擎修改 */
  plannedDuration: number;
  /** 消化超时后实际占用的时长（秒），等于 plannedDuration - compressedBy */
  computedDuration: number;
  /** 为保住固定点被压缩掉的秒数 */
  compressedBy: number;
}

/** 固定点前的等待空档（内容不足时产生） */
export interface GapRow {
  kind: 'gap';
  id: string;
  startOffset: number;
  endOffset: number;
  duration: number;
  beforeFixedSegmentId: string;
}

export type TimelineRow = ScheduledRow | GapRow;

/** 一次超时消化记录（某环节被压缩了多少、为了保哪个固定点） */
export interface Adjustment {
  segmentId: string;
  title: string;
  /** 压缩前实际时长（秒） */
  from: number;
  /** 压缩后实际时长（秒） */
  to: number;
  absorbed: number;
  fixedSegmentId: string;
  fixedTitle: string;
}

/** 固定点冲突：消化能力耗尽后仍放不下的部分 */
export interface Conflict {
  fixedSegmentId: string;
  fixedTitle: string;
  fixedStartOffset: number;
  /** 原始超时（秒） */
  overflow: number;
  /** 已被缓冲/压缩消化的部分（秒） */
  absorbed: number;
  /** 仍超出的部分（秒） */
  overBy: number;
  /** 实际结束时间越过固定点的环节 */
  overflowingSegmentIds: string[];
}

export interface ScheduleResult {
  rows: TimelineRow[];
  adjustments: Adjustment[];
  conflicts: Conflict[];
  /** 最后一个环节结束的偏移秒数（全档实际总时长） */
  endOffset: number;
  /** 计划总时长（各环节计划时长之和） */
  totalPlanned: number;
  /** 缓冲剩余（秒） */
  bufferRemaining: number;
  /** 可消化余量 = 缓冲剩余 + 可压缩环节剩余可压量（秒） */
  absorbableRemaining: number;
}

/**
 * 调度引擎：由环节列表推导整条时间轴（纯函数，不改输入）。
 *
 * 规则：
 * 1. 普通调整整体顺延——每个环节紧跟前一环节。
 * 2. 固定开播点不可越过：固定环节之前的超时，先从「上一个固定点（或开播）
 *    到本固定点之间」的缓冲段里扣，再按流程顺序压缩可压缩环节（压到下限为止）。
 * 3. 消化能力耗尽仍放不下 → 记录冲突；固定点仍在原时刻开播，绝不悄悄后移。
 * 4. 固定点前内容不足 → 留出空档，固定点依然准点。
 * 5. 已执行前缀（lockedIds）：已播出的环节既不能被压缩消化，时长也不再变化——
 *    消化跳过它们；若因此消化不下，按规则 3 报冲突，不改写已执行内容。
 */
export function computeSchedule(
  segments: Segment[],
  lockedIds?: ReadonlySet<string>,
): ScheduleResult {
  const rows: TimelineRow[] = [];
  const adjustments: Adjustment[] = [];
  const conflicts: Conflict[] = [];
  let cursor = 0;
  /** 当前消化区段内的环节行（上一个固定点之后、下一个固定点之前） */
  let zoneRows: ScheduledRow[] = [];

  /** 压缩后重排区段内各环节的开始/结束时间（第一行锚点不动） */
  const relayoutZone = () => {
    for (let i = 0; i < zoneRows.length; i++) {
      if (i > 0) zoneRows[i].startOffset = zoneRows[i - 1].endOffset;
      zoneRows[i].endOffset = zoneRows[i].startOffset + zoneRows[i].computedDuration;
    }
  };

  for (const seg of segments) {
    if (seg.kind !== 'fixed') {
      const row: ScheduledRow = {
        kind: 'segment',
        segment: seg,
        startOffset: cursor,
        endOffset: cursor + seg.duration,
        plannedDuration: seg.duration,
        computedDuration: seg.duration,
        compressedBy: 0,
      };
      rows.push(row);
      zoneRows.push(row);
      cursor = row.endOffset;
      continue;
    }

    const fixedAt = seg.fixedStartOffset ?? 0;
    const naturalStart = cursor;

    if (naturalStart > fixedAt) {
      // 超时：先吃缓冲，再压可压缩环节
      const overflow = naturalStart - fixedAt;
      let remaining = overflow;
      const absorbFrom = (kinds: Array<Segment['kind']>) => {
        for (const row of zoneRows) {
          if (remaining <= 0) break;
          if (!kinds.includes(row.segment.kind)) continue;
          if (lockedIds?.has(row.segment.id)) continue; // 已执行的环节不可再消化
          const available = row.computedDuration - row.segment.minDuration;
          if (available <= 0) continue;
          const take = Math.min(available, remaining);
          row.computedDuration -= take;
          row.compressedBy += take;
          remaining -= take;
          adjustments.push({
            segmentId: row.segment.id,
            title: row.segment.title,
            from: row.computedDuration + take,
            to: row.computedDuration,
            absorbed: take,
            fixedSegmentId: seg.id,
            fixedTitle: seg.title,
          });
        }
      };
      absorbFrom(['buffer']);
      absorbFrom(['compressible']);
      relayoutZone();

      if (remaining > 0) {
        conflicts.push({
          fixedSegmentId: seg.id,
          fixedTitle: seg.title,
          fixedStartOffset: fixedAt,
          overflow,
          absorbed: overflow - remaining,
          overBy: remaining,
          overflowingSegmentIds: zoneRows
            .filter((r) => r.endOffset > fixedAt)
            .map((r) => r.segment.id),
        });
      }
    } else if (naturalStart < fixedAt) {
      rows.push({
        kind: 'gap',
        id: `gap-before-${seg.id}`,
        startOffset: naturalStart,
        endOffset: fixedAt,
        duration: fixedAt - naturalStart,
        beforeFixedSegmentId: seg.id,
      });
    }

    // 固定点永远在自己的时刻开播
    rows.push({
      kind: 'segment',
      segment: seg,
      startOffset: fixedAt,
      endOffset: fixedAt + seg.duration,
      plannedDuration: seg.duration,
      computedDuration: seg.duration,
      compressedBy: 0,
    });
    cursor = fixedAt + seg.duration;
    zoneRows = [];
  }

  const segmentRows = rows.filter((r): r is ScheduledRow => r.kind === 'segment');
  const endOffset = rows.reduce((max, r) => Math.max(max, r.endOffset), 0);
  const totalPlanned = segments.reduce((sum, s) => sum + s.duration, 0);
  const bufferRemaining = segmentRows
    .filter((r) => r.segment.kind === 'buffer')
    .reduce((sum, r) => sum + r.computedDuration, 0);
  const absorbableRemaining =
    bufferRemaining +
    segmentRows
      .filter((r) => r.segment.kind === 'compressible')
      .reduce((sum, r) => sum + Math.max(0, r.computedDuration - r.segment.minDuration), 0);

  return { rows, adjustments, conflicts, endOffset, totalPlanned, bufferRemaining, absorbableRemaining };
}

/** 一个场地的排程结果 + 该场地被「已执行前缀」锁定的环节集合 */
export interface VenueSchedule {
  venue: Venue;
  result: ScheduleResult;
  lockedIds: Set<string>;
}

/**
 * 由「已执行行至」偏移推导锁定集合：
 * 排程开始时刻早于 executedUntil 的环节即视为已执行（已播出的内容不可改写）。
 */
export function lockedIdsFor(result: ScheduleResult, executedUntil: number): Set<string> {
  const ids = new Set<string>();
  if (executedUntil <= 0) return ids;
  for (const row of result.rows) {
    if (row.kind === 'segment' && row.startOffset < executedUntil) ids.add(row.segment.id);
  }
  return ids;
}

const LOCK_FIXPOINT_MAX_PASSES = 4;

/**
 * 计算单个场地的排程（含已执行前缀锁定）。
 *
 * 锁定集合与排程互相依赖：锁定影响消化 → 影响排程 → 影响哪些环节落在锁定线之前。
 * 从空锁定集开始迭代至不动点。已执行环节构成时间轴前缀、且永不被压缩，
 * 其开始时刻在迭代中只会前移不会越过锁定线，通常两轮内收敛。
 */
export function computeVenueSchedule(venue: Venue, executedUntil: number): VenueSchedule {
  let lockedIds = new Set<string>();
  let result = computeSchedule(venue.segments, lockedIds);
  for (let pass = 0; pass < LOCK_FIXPOINT_MAX_PASSES; pass++) {
    const next = lockedIdsFor(result, executedUntil);
    const same = next.size === lockedIds.size && [...next].every((id) => lockedIds.has(id));
    if (same) return { venue, result, lockedIds: next };
    lockedIds = next;
    result = computeSchedule(venue.segments, lockedIds);
  }
  return { venue, result, lockedIds };
}
