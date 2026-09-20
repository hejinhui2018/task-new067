import { describe, expect, it } from 'vitest';
import { computeSchedule } from '../engine/schedule';
import type { ScheduledRow } from '../engine/schedule';
import { computeShowSchedule } from '../engine/multiSchedule';
import type { Segment } from '../types';
import { createInitialHistory, rundownReducer, uid } from './reducer';

const MAIN = 'main';
const ROOM = 'interview-room';

const mainSegments = (h: ReturnType<typeof createInitialHistory>) =>
  h.present.venues.find((v) => v.id === MAIN)!.segments;

const rowOf = (segments: Segment[], id: string): ScheduledRow => {
  const row = computeSchedule(segments).rows.find(
    (x): x is ScheduledRow => x.kind === 'segment' && x.segment.id === id,
  );
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};

describe('撤销 / 重做', () => {
  it('修改时长后撤销，时间与消化明细一起恢复；重做后再次生效', () => {
    let h = createInitialHistory();
    const original = computeSchedule(mainSegments(h));

    // 采访延长 4 分钟 → 缓冲耗尽 + 新闻被压缩
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'interview', duration: 600 });
    const adjusted = computeSchedule(mainSegments(h));
    expect(adjusted.adjustments).toHaveLength(2);
    expect(rowOf(mainSegments(h), 'live').startOffset).toBe(900);
    expect(rowOf(mainSegments(h), 'buffer').computedDuration).toBe(0);

    h = rundownReducer(h, { type: 'UNDO' });
    expect(computeSchedule(mainSegments(h))).toEqual(original);

    h = rundownReducer(h, { type: 'REDO' });
    const redone = computeSchedule(mainSegments(h));
    expect(redone.adjustments).toHaveLength(2);
    expect(rowOf(mainSegments(h), 'buffer').computedDuration).toBe(0);
    expect(rowOf(mainSegments(h), 'news').computedDuration).toBe(180);
  });

  it('冲突状态随撤销/重做一起恢复', () => {
    let h = createInitialHistory();
    // 开场 +7:00，超出消化能力（缓冲 2:00 + 新闻 2:00 + 采访 2:00）→ 冲突 1:00
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'opening', duration: 120 + 420 });
    const withConflict = computeSchedule(mainSegments(h));
    expect(withConflict.conflicts).toHaveLength(1);
    expect(withConflict.conflicts[0].overBy).toBe(60);
    expect(rowOf(mainSegments(h), 'live').startOffset).toBe(900); // 固定点仍不动

    h = rundownReducer(h, { type: 'UNDO' });
    expect(computeSchedule(mainSegments(h)).conflicts).toHaveLength(0);

    h = rundownReducer(h, { type: 'REDO' });
    expect(computeSchedule(mainSegments(h)).conflicts).toHaveLength(1);
  });

  it('空历史时撤销/重做为安全空操作；新修改清空重做栈', () => {
    let h = createInitialHistory();
    expect(rundownReducer(h, { type: 'UNDO' })).toBe(h);
    expect(rundownReducer(h, { type: 'REDO' })).toBe(h);

    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'news', duration: 240 });
    h = rundownReducer(h, { type: 'UNDO' });
    expect(h.future).toHaveLength(1);
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'news', duration: 200 });
    expect(h.future).toHaveLength(0);
  });
});

describe('排序 / 固定点 / 增删', () => {
  it('拖动排序并可撤销', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, { type: 'REORDER', venueId: MAIN, from: 0, to: 3 });
    expect(mainSegments(h).map((s) => s.id)).toEqual([
      'news', 'interview', 'opening', 'buffer', 'live', 'comment', 'credits',
    ]);
    h = rundownReducer(h, { type: 'UNDO' });
    expect(mainSegments(h).map((s) => s.id)).toEqual([
      'opening', 'news', 'interview', 'buffer', 'live', 'comment', 'credits',
    ]);
  });

  it('设为固定开播点：锁定当前开始时间，不扰动流程', () => {
    let h = createInitialHistory();
    const before = computeSchedule(mainSegments(h));

    h = rundownReducer(h, { type: 'TOGGLE_FIXED', venueId: MAIN, id: 'comment' });
    const comment = mainSegments(h).find((s) => s.id === 'comment')!;
    expect(comment.kind).toBe('fixed');
    expect(comment.fixedStartOffset).toBe(1200); // 连线 10:15 + 5:00

    const after = computeSchedule(mainSegments(h));
    expect(after.conflicts).toHaveLength(0);
    expect(after.adjustments).toHaveLength(0);
    expect(after.rows.map((r) => r.startOffset)).toEqual(before.rows.map((r) => r.startOffset));
    expect(after.endOffset).toBe(before.endOffset);

    h = rundownReducer(h, { type: 'TOGGLE_FIXED', venueId: MAIN, id: 'comment' });
    expect(mainSegments(h).find((s) => s.id === 'comment')!.kind).toBe('normal');
  });

  it('时长不会低于环节下限', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'interview', duration: 60 });
    expect(mainSegments(h).find((s) => s.id === 'interview')!.duration).toBe(240); // 压缩下限
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'buffer', duration: -10 });
    expect(mainSegments(h).find((s) => s.id === 'buffer')!.duration).toBe(0);
  });

  it('插入环节触发重新排程，删除后恢复', () => {
    let h = createInitialHistory();
    const extra: Segment = { id: uid(), title: '快讯', kind: 'normal', duration: 90, minDuration: 0, resources: [] };
    h = rundownReducer(h, { type: 'INSERT_AT', venueId: MAIN, index: 1, segment: extra });
    expect(mainSegments(h)[1].id).toBe(extra.id);
    // 多出的 90 秒先由缓冲消化，固定点不动
    expect(rowOf(mainSegments(h), 'buffer').computedDuration).toBe(30);
    expect(rowOf(mainSegments(h), 'live').startOffset).toBe(900);

    h = rundownReducer(h, { type: 'DELETE', venueId: MAIN, id: extra.id });
    expect(mainSegments(h).find((s) => s.id === extra.id)).toBeUndefined();
    expect(computeSchedule(mainSegments(h)).endOffset).toBe(1800);
  });
});

describe('跨场地移动', () => {
  it('环节可从主舞台移到访谈间，撤销后还原', () => {
    let h = createInitialHistory();
    const roomBefore = h.present.venues.find((v) => v.id === ROOM)!.segments;

    h = rundownReducer(h, {
      type: 'MOVE_BETWEEN_VENUES',
      segmentId: 'comment',
      fromVenueId: MAIN,
      toVenueId: ROOM,
      index: 1,
    });
    expect(mainSegments(h).find((s) => s.id === 'comment')).toBeUndefined();
    const roomAfter = h.present.venues.find((v) => v.id === ROOM)!.segments;
    expect(roomAfter).toHaveLength(roomBefore.length + 1);
    expect(roomAfter[1].id).toBe('comment');
    expect(roomAfter[1].resources).toEqual(['主持人A', '评论员']); // 资源随环节走

    h = rundownReducer(h, { type: 'UNDO' });
    expect(mainSegments(h).map((s) => s.id)).toContain('comment');
    expect(h.present.venues.find((v) => v.id === ROOM)!.segments).toHaveLength(roomBefore.length);
  });

  it('同一场地的 MOVE 请求与未知场地为安全空操作', () => {
    const h = createInitialHistory();
    expect(
      rundownReducer(h, {
        type: 'MOVE_BETWEEN_VENUES',
        segmentId: 'comment',
        fromVenueId: MAIN,
        toVenueId: MAIN,
        index: 0,
      }),
    ).toBe(h);
    expect(
      rundownReducer(h, {
        type: 'MOVE_BETWEEN_VENUES',
        segmentId: 'comment',
        fromVenueId: MAIN,
        toVenueId: 'nowhere',
        index: 0,
      }),
    ).toBe(h);
  });
});

describe('已执行前缀锁定', () => {
  /** 锁定 10:10（偏移 600）：主舞台 开场/新闻/采访 已执行，访谈间 布置/预热 已执行 */
  const lockAt600 = (h: ReturnType<typeof createInitialHistory>) =>
    rundownReducer(h, { type: 'LOCK_EXECUTED', offset: 600 });

  it('锁定后已执行环节不可改时长、改名、删除、排序', () => {
    let h = createInitialHistory();
    h = lockAt600(h);
    expect(h.present.executedUntil).toEqual({ [MAIN]: 600, [ROOM]: 600 });

    const before = h.present;
    // 采访（10:07 开始）已执行：以下操作全部无效
    expect(rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'interview', duration: 900 }).present).toBe(before);
    expect(rundownReducer(h, { type: 'UPDATE_TITLE', venueId: MAIN, id: 'interview', title: 'x' }).present).toBe(before);
    expect(rundownReducer(h, { type: 'DELETE', venueId: MAIN, id: 'interview' }).present).toBe(before);
    expect(rundownReducer(h, { type: 'TOGGLE_FIXED', venueId: MAIN, id: 'interview' }).present).toBe(before);
    // 排序会移动已执行环节 → 无效
    expect(rundownReducer(h, { type: 'REORDER', venueId: MAIN, from: 0, to: 3 }).present).toBe(before);
    // 在已执行前缀之前插入 → 无效
    expect(
      rundownReducer(h, {
        type: 'INSERT_AT',
        venueId: MAIN,
        index: 1,
        segment: { id: 'x', title: 'x', kind: 'normal', duration: 60, minDuration: 0, resources: [] },
      }).present,
    ).toBe(before);
    // 跨场地移动已执行环节 → 无效
    expect(
      rundownReducer(h, {
        type: 'MOVE_BETWEEN_VENUES',
        segmentId: 'interview',
        fromVenueId: MAIN,
        toVenueId: ROOM,
        index: 5,
      }).present,
    ).toBe(before);
  });

  it('锁定线之后的环节仍可正常编辑', () => {
    let h = createInitialHistory();
    h = lockAt600(h);
    // 评论 10:20 开始，未锁定
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'comment', duration: 540 });
    expect(mainSegments(h).find((s) => s.id === 'comment')!.duration).toBe(540);
    // 未锁定区段内排序有效（评论 ↔ 片尾）
    h = rundownReducer(h, { type: 'REORDER', venueId: MAIN, from: 5, to: 7 });
    expect(mainSegments(h).map((s) => s.id)).toEqual([
      'opening', 'news', 'interview', 'buffer', 'live', 'credits', 'comment',
    ]);
  });

  it('解除锁定后恢复可编辑；锁定与解锁都可撤销', () => {
    let h = createInitialHistory();
    h = lockAt600(h);
    h = rundownReducer(h, { type: 'CLEAR_EXECUTED_LOCKS' });
    expect(h.present.executedUntil).toEqual({});
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'interview', duration: 900 });
    expect(mainSegments(h).find((s) => s.id === 'interview')!.duration).toBe(900);

    h = rundownReducer(h, { type: 'UNDO' }); // 撤销改时长
    h = rundownReducer(h, { type: 'UNDO' }); // 撤销解锁 → 重新锁定
    expect(h.present.executedUntil[MAIN]).toBe(600);
    h = rundownReducer(h, { type: 'UNDO' }); // 撤销锁定
    expect(h.present.executedUntil).toEqual({});
  });
});

describe('APPLY_OPS（资源冲突建议）', () => {
  it('应用一组操作并可撤销', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, {
      type: 'APPLY_OPS',
      ops: [{ type: 'set-duration', venueId: MAIN, segmentId: 'interview', duration: 480 }],
    });
    expect(mainSegments(h).find((s) => s.id === 'interview')!.duration).toBe(480);
    h = rundownReducer(h, { type: 'UNDO' });
    expect(mainSegments(h).find((s) => s.id === 'interview')!.duration).toBe(360);
  });

  it('触及已执行环节的操作组被整体拒绝', () => {
    let h = createInitialHistory();
    h = rundownReducer(h, { type: 'LOCK_EXECUTED', offset: 600 });
    const before = h.present;
    h = rundownReducer(h, {
      type: 'APPLY_OPS',
      ops: [
        { type: 'set-duration', venueId: MAIN, segmentId: 'comment', duration: 300 },
        { type: 'set-duration', venueId: MAIN, segmentId: 'interview', duration: 300 }, // 已执行
      ],
    });
    expect(h.present).toBe(before);
  });
});

describe('端到端：延长主舞台环节 → 资源冲突 → 一键建议 → 撤销', () => {
  it('完整链路', () => {
    let h = createInitialHistory();
    // 采访延长到 8:00 → 嘉宾-陈 与访谈间专访撞车
    h = rundownReducer(h, { type: 'UPDATE_DURATION', venueId: MAIN, id: 'interview', duration: 480 });
    let show = computeShowSchedule(h.present);
    expect(show.resourceConflicts).toHaveLength(1);
    expect(show.resourceConflicts[0].resource).toBe('嘉宾-陈');
    expect(show.resourceConflicts[0].suggestions.length).toBeGreaterThan(0);

    // 应用第一条建议 → 冲突消除，且不产生固定点冲突
    const first = show.resourceConflicts[0].suggestions[0];
    h = rundownReducer(h, { type: 'APPLY_OPS', ops: first.ops });
    show = computeShowSchedule(h.present);
    expect(show.resourceConflicts).toHaveLength(0);
    expect(show.fixedConflictCount).toBe(0);

    // 撤销两步回到初始状态
    h = rundownReducer(h, { type: 'UNDO' });
    h = rundownReducer(h, { type: 'UNDO' });
    show = computeShowSchedule(h.present);
    expect(show.resourceConflicts).toHaveLength(0);
    expect(mainSegments(h).find((s) => s.id === 'interview')!.duration).toBe(360);
  });
});
