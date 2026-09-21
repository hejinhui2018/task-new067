import type { RundownState, VenueId } from '../types';
import { computeSchedule } from './schedule';
import type { ScheduleResult } from './schedule';
import { detectResourceConflicts } from './resources';
import type { ResourceConflict } from './resources';

/** 单个场地的排程结果 */
export interface VenueSchedule {
  venueId: VenueId;
  name: string;
  schedule: ScheduleResult;
  /** 已执行锁定行数 */
  lockedCount: number;
}

export interface ShowSchedule {
  venues: VenueSchedule[];
  /** 按场地 id 索引 */
  byVenue: Map<VenueId, VenueSchedule>;
  /** 跨场地共享资源碰撞 */
  resourceConflicts: ResourceConflict[];
  /** 全部场地固定点冲突（各场地内消化不下的超时） */
  fixedConflicts: ScheduleResult['conflicts'];
  /** 两场地最晚结束偏移 */
  endOffset: number;
  /** 计划总时长（取各场地计划和的最大值） */
  totalPlanned: number;
  bufferRemaining: number;
  absorbableRemaining: number;
  /** 已锁定的已执行环节总数 */
  lockedCount: number;
}

const FALLBACK_VENUES = [{ id: 'A' as VenueId, name: '主舞台' }];

/**
 * 双场地联排总调度：各场地时间线独立顺延/消化，固定点冲突各自上报，
 * 共享资源占用跨场地统一碰撞校验。
 */
export function computeShowSchedule(state: RundownState): ShowSchedule {
  const venues = state.venues && state.venues.length > 0 ? state.venues : FALLBACK_VENUES;
  const byVenue = new Map<VenueId, VenueSchedule>();
  let endOffset = 0;
  let totalPlanned = 0;
  let bufferRemaining = 0;
  let absorbableRemaining = 0;
  let lockedCount = 0;
  const fixedConflicts: ScheduleResult['conflicts'] = [];

  for (const v of venues) {
    const segs = state.segments.filter((s) => (s.venue ?? 'A') === v.id);
    const schedule = computeSchedule(segs);
    const vc = schedule.rows.filter(
      (r) => r.kind === 'segment' && r.locked,
    ).length;
    const vs: VenueSchedule = { venueId: v.id, name: v.name, schedule, lockedCount: vc };
    byVenue.set(v.id, vs);
    endOffset = Math.max(endOffset, schedule.endOffset);
    totalPlanned = Math.max(totalPlanned, schedule.totalPlanned);
    bufferRemaining += schedule.bufferRemaining;
    absorbableRemaining += schedule.absorbableRemaining;
    lockedCount += vc;
    fixedConflicts.push(
      ...schedule.conflicts.map((c) => ({ ...c, fixedTitle: `${v.name}·${c.fixedTitle}` })),
    );
  }

  const resourceConflicts = detectResourceConflicts(state);

  return {
    venues: [...byVenue.values()],
    byVenue,
    resourceConflicts,
    fixedConflicts,
    endOffset,
    totalPlanned,
    bufferRemaining,
    absorbableRemaining,
    lockedCount,
  };
}
