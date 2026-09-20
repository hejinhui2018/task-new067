import type { RundownState } from '../types';
import { computeVenueSchedule } from './schedule';
import type { VenueSchedule } from './schedule';
import { detectResourceConflicts, suggestResolutions } from './resources';
import type { ResourceConflict } from './resources';

/** 整档节目的排程：各场地时间线 + 跨场地资源冲突（含可行调整建议） */
export interface ShowSchedule {
  venues: VenueSchedule[];
  resourceConflicts: ResourceConflict[];
  /** 全档实际结束偏移 = 各场地最晚结束时刻 */
  endOffset: number;
  totalPlanned: number;
  bufferRemaining: number;
  absorbableRemaining: number;
  /** 固定点冲突总数（各场地合计） */
  fixedConflictCount: number;
  adjustmentCount: number;
}

/**
 * 双场地联排入口：各场地独立排程（固定点/可压缩/缓冲/已执行前缀规则不变），
 * 再统一校验共享资源，并为每个资源冲突生成经过模拟验证的调整建议。
 */
export function computeShowSchedule(state: RundownState): ShowSchedule {
  const venues = state.venues.map((v) => computeVenueSchedule(v, state.executedUntil[v.id] ?? 0));
  const detected = detectResourceConflicts(venues);
  const resourceConflicts = detected.map((c) => ({
    ...c,
    suggestions: suggestResolutions(state, venues, c),
  }));

  return {
    venues,
    resourceConflicts,
    endOffset: venues.reduce((max, v) => Math.max(max, v.result.endOffset), 0),
    totalPlanned: venues.reduce((sum, v) => sum + v.result.totalPlanned, 0),
    bufferRemaining: venues.reduce((sum, v) => sum + v.result.bufferRemaining, 0),
    absorbableRemaining: venues.reduce((sum, v) => sum + v.result.absorbableRemaining, 0),
    fixedConflictCount: venues.reduce((sum, v) => sum + v.result.conflicts.length, 0),
    adjustmentCount: venues.reduce((sum, v) => sum + v.result.adjustments.length, 0),
  };
}
