import type { RundownState, Segment, Venue } from '../types';
import { MIN_SEGMENT_DURATION } from '../types';
import { computeVenueSchedule } from './schedule';
import type { VenueSchedule } from './schedule';
import { fmtClock, fmtDur } from './time';

/** 一次资源占用：某环节在其场地时间线上占据的区间（距开播秒数） */
export interface ResourceUsage {
  resource: string;
  venueId: string;
  venueName: string;
  segmentId: string;
  title: string;
  startOffset: number;
  endOffset: number;
}

/** 跨场地资源冲突（尚未附带调整建议） */
export interface DetectedResourceConflict {
  id: string;
  resource: string;
  /** 冲突区间：资源被重复占用的时间范围（距开播秒数） */
  startOffset: number;
  endOffset: number;
  /** 涉及环节（按开始时间排序，可能多于两个） */
  usages: ResourceUsage[];
}

/** 一条可一键应用的调整动作（纯数据，reducer 与引擎模拟共用） */
export type StateOp =
  | { type: 'set-duration'; venueId: string; segmentId: string; duration: number }
  | { type: 'insert'; venueId: string; index: number; segment: Segment }
  | { type: 'move'; segmentId: string; fromVenueId: string; toVenueId: string; index: number };

/** 可行调整建议：经整档模拟验证——应用后该冲突消除，且不新增固定点/资源冲突 */
export interface Suggestion {
  id: string;
  label: string;
  ops: StateOp[];
}

export interface ResourceConflict extends DetectedResourceConflict {
  suggestions: Suggestion[];
}

/**
 * 检测跨场地资源冲突：同一资源在不同场地的排程区间重叠即冲突。
 * 重叠按传递闭包聚簇（A 撞 B、B 撞 C 归为同一冲突），
 * 同场地内的重叠属于固定点冲突范畴，不在此重复上报。
 */
export function detectResourceConflicts(venues: VenueSchedule[]): DetectedResourceConflict[] {
  const byResource = new Map<string, ResourceUsage[]>();
  for (const v of venues) {
    for (const row of v.result.rows) {
      if (row.kind !== 'segment') continue;
      for (const resource of row.segment.resources) {
        const list = byResource.get(resource) ?? [];
        list.push({
          resource,
          venueId: v.venue.id,
          venueName: v.venue.name,
          segmentId: row.segment.id,
          title: row.segment.title,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
        });
        byResource.set(resource, list);
      }
    }
  }

  const conflicts: DetectedResourceConflict[] = [];
  for (const [resource, usages] of byResource) {
    if (usages.length < 2) continue;
    const sorted = [...usages].sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);

    let cluster: ResourceUsage[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const venueIds = new Set(cluster.map((u) => u.venueId));
      if (cluster.length >= 2 && venueIds.size >= 2) {
        // 冲突区间 = 跨场地两两重叠区间的并
        let start = Infinity;
        let end = -Infinity;
        for (let i = 0; i < cluster.length; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            if (cluster[i].venueId === cluster[j].venueId) continue;
            const s = Math.max(cluster[i].startOffset, cluster[j].startOffset);
            const e = Math.min(cluster[i].endOffset, cluster[j].endOffset);
            if (e > s) {
              start = Math.min(start, s);
              end = Math.max(end, e);
            }
          }
        }
        if (end > start) {
          conflicts.push({
            id: `${resource}@${start}`,
            resource,
            startOffset: start,
            endOffset: end,
            usages: [...cluster],
          });
        }
      }
      cluster = [];
      clusterEnd = -Infinity;
    };

    for (const u of sorted) {
      if (u.startOffset < clusterEnd) {
        cluster.push(u);
        clusterEnd = Math.max(clusterEnd, u.endOffset);
      } else {
        flush();
        cluster = [u];
        clusterEnd = u.endOffset;
      }
    }
    flush();
  }
  return conflicts.sort((a, b) => a.startOffset - b.startOffset || a.resource.localeCompare(b.resource));
}

/** 对整档状态应用一组调整动作（纯函数，不改输入） */
export function applyOps(state: RundownState, ops: StateOp[]): RundownState {
  let venues = state.venues;
  for (const op of ops) {
    if (op.type === 'set-duration') {
      venues = venues.map((v) =>
        v.id !== op.venueId
          ? v
          : {
              ...v,
              segments: v.segments.map((s) =>
                s.id === op.segmentId ? { ...s, duration: Math.max(0, Math.round(op.duration)) } : s,
              ),
            },
      );
    } else if (op.type === 'insert') {
      venues = venues.map((v) => {
        if (v.id !== op.venueId) return v;
        const segments = [...v.segments];
        segments.splice(Math.max(0, Math.min(Math.round(op.index), segments.length)), 0, op.segment);
        return { ...v, segments };
      });
    } else {
      let moved: Segment | undefined;
      venues = venues.map((v) => {
        if (v.id !== op.fromVenueId) return v;
        return {
          ...v,
          segments: v.segments.filter((s) => {
            if (s.id === op.segmentId) {
              moved = s;
              return false;
            }
            return true;
          }),
        };
      });
      if (!moved) continue;
      const seg = moved;
      venues = venues.map((v) => {
        if (v.id !== op.toVenueId) return v;
        const segments = [...v.segments];
        segments.splice(Math.max(0, Math.min(Math.round(op.index), segments.length)), 0, seg);
        return { ...v, segments };
      });
    }
  }
  return { ...state, venues };
}

/** 场地内最后一个被锁定（已执行）环节的下标；无锁定时为 -1 */
export function lastLockedIndex(venue: Venue, lockedIds: ReadonlySet<string>): number {
  let last = -1;
  venue.segments.forEach((s, i) => {
    if (lockedIds.has(s.id)) last = i;
  });
  return last;
}

/** 缩短操作允许到达的时长下限（与 reducer 的钳制规则一致） */
function durationFloor(seg: Segment): number {
  if (seg.kind === 'buffer') return 0;
  if (seg.kind === 'compressible') return seg.minDuration;
  return MIN_SEGMENT_DURATION;
}

/**
 * 为一个资源冲突生成可行调整建议。
 *
 * 候选方案（都是针对性调整，绝不把后续内容一起顺延）：
 * 1. 缩短先占用资源的环节，在对方开始前让出资源；
 * 2. 在后占用方之前插入垫片，把它（及其后续）推迟到资源空出之后；
 * 3/4. 把其中一方移到另一场地、排在对方之后。
 *
 * 每个候选都在整档状态上模拟验证：应用后本冲突必须消除，
 * 且不得新增固定点冲突或其他资源冲突——不满足的方案不会出现在建议里。
 * 全部不可行时返回空数组（无解场景），由界面提示人工处理。
 */
export function suggestResolutions(
  state: RundownState,
  venueSchedules: VenueSchedule[],
  conflict: DetectedResourceConflict,
): Suggestion[] {
  const lockedOf = new Map(venueSchedules.map((v) => [v.venue.id, v.lockedIds] as const));
  const isLocked = (venueId: string, segmentId: string) =>
    lockedOf.get(venueId)?.has(segmentId) ?? false;
  const venueOf = (venueId: string) => state.venues.find((v) => v.id === venueId);
  const segOf = (venueId: string, segmentId: string) =>
    venueOf(venueId)?.segments.find((s) => s.id === segmentId);
  const indexOf = (venueId: string, segmentId: string) =>
    venueOf(venueId)?.segments.findIndex((s) => s.id === segmentId) ?? -1;

  const currentFixed = venueSchedules.reduce((n, v) => n + v.result.conflicts.length, 0);
  const currentResource = detectResourceConflicts(venueSchedules).length;
  const conflictSegmentIds = new Set(conflict.usages.map((u) => u.segmentId));

  const simulate = (ops: StateOp[]): boolean => {
    const next = applyOps(state, ops);
    const nextVenues = next.venues.map((v) => computeVenueSchedule(v, next.executedUntil[v.id] ?? 0));
    if (nextVenues.reduce((n, v) => n + v.result.conflicts.length, 0) > currentFixed) return false;
    const nextResource = detectResourceConflicts(nextVenues);
    if (nextResource.length >= currentResource) return false;
    return !nextResource.some(
      (c) => c.resource === conflict.resource && c.usages.some((u) => conflictSegmentIds.has(u.segmentId)),
    );
  };

  const overlap = conflict.endOffset - conflict.startOffset;
  if (overlap <= 0 || conflict.usages.length < 2) return [];
  const [first, second] = conflict.usages;
  const firstSeg = segOf(first.venueId, first.segmentId);
  const secondSeg = segOf(second.venueId, second.segmentId);
  if (!firstSeg || !secondSeg) return [];

  const clock = (off: number) => fmtClock(state.showStartSeconds + off);
  const candidates: Suggestion[] = [];

  // 1. 缩短先占用方，在对方开始前让出资源
  if (!isLocked(first.venueId, first.segmentId)) {
    const newDuration = second.startOffset - first.startOffset;
    if (newDuration >= durationFloor(firstSeg)) {
      candidates.push({
        id: `shorten-${first.segmentId}`,
        label: `「${first.title}」缩短 ${fmtDur(overlap)}，${clock(second.startOffset)} 前让出「${conflict.resource}」`,
        ops: [{ type: 'set-duration', venueId: first.venueId, segmentId: first.segmentId, duration: newDuration }],
      });
    }
  }

  // 2. 在后占用方之前插入垫片，推迟到先占用方结束之后
  // （推迟量 = 先占用方结束时刻 - 后占用方开始时刻；当后者被前者完全包含时大于重叠量）
  const delayBy = first.endOffset - second.startOffset;
  if (!isLocked(second.venueId, second.segmentId) && delayBy > 0) {
    const venue = venueOf(second.venueId);
    const at = indexOf(second.venueId, second.segmentId);
    if (venue && at > lastLockedIndex(venue, lockedOf.get(second.venueId) ?? new Set())) {
      let fillerId = `filler-${second.segmentId}`;
      let n = 2;
      while (state.venues.some((v) => v.segments.some((s) => s.id === fillerId))) {
        fillerId = `filler-${second.segmentId}-${n++}`;
      }
      candidates.push({
        id: `delay-${second.segmentId}`,
        label: `在「${second.title}」前插入 ${fmtDur(delayBy)} 垫片，推迟到 ${clock(second.startOffset + delayBy)} 开始`,
        ops: [
          {
            type: 'insert',
            venueId: second.venueId,
            index: at,
            segment: { id: fillerId, title: '垫片', kind: 'buffer', duration: delayBy, minDuration: 0, resources: [] },
          },
        ],
      });
    }
  }

  // 3/4. 把一方移到另一场地、排在对方之后（资源在同一场地内串行使用）
  const moveCases: Array<{ usage: ResourceUsage; other: ResourceUsage; kind: string }> = [
    { usage: second, other: first, kind: 'move-second' },
    { usage: first, other: second, kind: 'move-first' },
  ];
  for (const { usage, other, kind } of moveCases) {
    if (usage.venueId === other.venueId) continue;
    if (isLocked(usage.venueId, usage.segmentId)) continue;
    const targetVenue = venueOf(other.venueId);
    const insertAt = indexOf(other.venueId, other.segmentId) + 1;
    if (!targetVenue || insertAt <= lastLockedIndex(targetVenue, lockedOf.get(other.venueId) ?? new Set())) {
      continue;
    }
    candidates.push({
      id: `${kind}-${usage.segmentId}`,
      label: `「${usage.title}」移到${other.venueName}，排在「${other.title}」之后`,
      ops: [
        {
          type: 'move',
          segmentId: usage.segmentId,
          fromVenueId: usage.venueId,
          toVenueId: other.venueId,
          index: insertAt,
        },
      ],
    });
  }

  return candidates.filter((c) => simulate(c.ops));
}
