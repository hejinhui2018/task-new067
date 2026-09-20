import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';

/**
 * 告警区：
 * - 跨场地资源冲突（红）：冲突区间、涉及环节与经过模拟验证的一键调整建议；
 *   无解时明确提示人工处理，绝不把所有后续内容一起顺延。
 * - 固定点冲突（红）与超时消化明细（琥珀），按场地分组。
 */
export function AlertsPanel() {
  const { present, schedule, dispatch } = useRundown();
  const { resourceConflicts } = schedule;
  const fixedConflicts = schedule.venues.flatMap((v) =>
    v.result.conflicts.map((c) => ({ venueName: v.venue.name, conflict: c })),
  );
  const adjustmentGroups = schedule.venues.flatMap((v) => {
    const groups = new Map<string, typeof v.result.adjustments>();
    for (const a of v.result.adjustments) {
      const list = groups.get(a.fixedSegmentId) ?? [];
      list.push(a);
      groups.set(a.fixedSegmentId, list);
    }
    return [...groups.entries()].map(([fixedId, list]) => ({
      venueName: v.venue.name,
      fixedId,
      list,
    }));
  });

  if (resourceConflicts.length === 0 && fixedConflicts.length === 0 && adjustmentGroups.length === 0) {
    return null;
  }

  const titleOf = (id: string) =>
    present.venues.flatMap((v) => v.segments).find((s) => s.id === id)?.title ?? id;
  const fixedStartOf = (id: string) =>
    present.venues.flatMap((v) => v.segments).find((s) => s.id === id)?.fixedStartOffset ?? 0;

  const clock = (off: number) => fmtClock(present.showStartSeconds + off);

  const diff = schedule.endOffset - present.slotDuration;
  const endingLine =
    diff > 0
      ? `最晚收尾 ${clock(schedule.endOffset)}，超出播出窗口 +${fmtDur(diff)}。`
      : diff < 0
        ? `全档 ${clock(schedule.endOffset)} 收尾，窗口内剩余 ${fmtDur(-diff)}，片尾未受影响。`
        : `全档 ${clock(schedule.endOffset)} 准点收尾，片尾未受影响。`;

  return (
    <section className="alerts">
      {resourceConflicts.map((c) => (
        <div key={c.id} className="banner banner-red" role="alert">
          <strong>⚠ 资源冲突「{c.resource}」</strong>
          <span>
            {clock(c.startOffset)}–{clock(c.endOffset)}（{fmtDur(c.endOffset - c.startOffset)}）被两处占用：
            {c.usages
              .map(
                (u) =>
                  `${u.venueName}·「${u.title}」${clock(u.startOffset)}–${clock(u.endOffset)}`,
              )
              .join('；')}
            。同一资源不能同时出现在两个场地。
          </span>
          {c.suggestions.length > 0 ? (
            <span className="suggestions">
              <span className="suggestions-title">可行调整（已模拟验证，点击应用）：</span>
              {c.suggestions.map((s) => (
                <button
                  key={s.id}
                  className="suggestion-btn"
                  onClick={() => dispatch({ type: 'APPLY_OPS', ops: s.ops })}
                  title="应用该调整（可撤销）"
                >
                  {s.label}
                </button>
              ))}
            </span>
          ) : (
            <span className="suggestions">
              <span className="suggestions-title bad-text">
                暂无可行的一键调整：涉及环节已执行锁定，或调整会撞固定点/产生新冲突。请手动缩短、改期或更换资源。
              </span>
            </span>
          )}
        </div>
      ))}
      {fixedConflicts.map(({ venueName, conflict: c }) => (
        <div key={c.fixedSegmentId} className="banner banner-red" role="alert">
          <strong>⚠ 固定点冲突 · {venueName}</strong>
          <span>
            「{c.fixedTitle}」须 {clock(c.fixedStartOffset)} 准点开播，
            前序内容超时 {fmtDur(c.overflow)}；缓冲与可压缩空间已消化 {fmtDur(c.absorbed)}，
            仍超出 <b>{fmtDur(c.overBy)}</b>
            {c.overflowingSegmentIds.length > 0 && `（涉及：${c.overflowingSegmentIds.map(titleOf).join('、')}）`}。
            请缩短前序环节、后移固定点或删减内容——系统不会悄悄越过固定点。
          </span>
        </div>
      ))}
      {adjustmentGroups.map(({ venueName, fixedId, list }) => {
        const total = list.reduce((sum, a) => sum + a.absorbed, 0);
        return (
          <div key={`${venueName}-${fixedId}`} className="banner banner-amber">
            <strong>✓ 已自动消化超时 {fmtDur(total)} · {venueName}</strong>
            <span>
              为保住固定点「{titleOf(fixedId)} {clock(fixedStartOf(fixedId))}」：
              {list
                .map((a) => `「${a.title}」${fmtDur(a.from)} → ${fmtDur(a.to)}（-${fmtDur(a.absorbed)}）`)
                .join('，')}
              。{endingLine}
            </span>
          </div>
        );
      })}
    </section>
  );
}
