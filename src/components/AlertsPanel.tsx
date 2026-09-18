import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';

/** 告警区：固定点冲突（红）与超时消化明细（琥珀），并说明片尾是否受影响 */
export function AlertsPanel() {
  const { present, schedule } = useRundown();
  const { conflicts, adjustments } = schedule;
  if (conflicts.length === 0 && adjustments.length === 0) return null;

  const titleOf = (id: string) => present.segments.find((s) => s.id === id)?.title ?? id;
  const fixedStartOf = (id: string) =>
    present.segments.find((s) => s.id === id)?.fixedStartOffset ?? 0;

  const groups = new Map<string, typeof adjustments>();
  for (const a of adjustments) {
    const list = groups.get(a.fixedSegmentId) ?? [];
    list.push(a);
    groups.set(a.fixedSegmentId, list);
  }

  const diff = schedule.endOffset - present.slotDuration;
  const endingLine =
    diff > 0
      ? `片尾顺延至 ${fmtClock(present.showStartSeconds + schedule.endOffset)}，超出播出窗口 +${fmtDur(diff)}。`
      : diff < 0
        ? `全档 ${fmtClock(present.showStartSeconds + schedule.endOffset)} 收尾，窗口内剩余 ${fmtDur(-diff)}，片尾未受影响。`
        : `全档 ${fmtClock(present.showStartSeconds + schedule.endOffset)} 准点收尾，片尾未受影响。`;

  return (
    <section className="alerts">
      {conflicts.map((c) => (
        <div key={c.fixedSegmentId} className="banner banner-red" role="alert">
          <strong>⚠ 固定点冲突</strong>
          <span>
            「{c.fixedTitle}」须 {fmtClock(present.showStartSeconds + c.fixedStartOffset)} 准点开播，
            前序内容超时 {fmtDur(c.overflow)}；缓冲与可压缩空间已消化 {fmtDur(c.absorbed)}，
            仍超出 <b>{fmtDur(c.overBy)}</b>
            {c.overflowingSegmentIds.length > 0 && `（涉及：${c.overflowingSegmentIds.map(titleOf).join('、')}）`}。
            请缩短前序环节、后移固定点或删减内容——系统不会悄悄越过固定点。
          </span>
        </div>
      ))}
      {[...groups.entries()].map(([fixedId, list]) => {
        const total = list.reduce((sum, a) => sum + a.absorbed, 0);
        return (
          <div key={fixedId} className="banner banner-amber">
            <strong>✓ 已自动消化超时 {fmtDur(total)}</strong>
            <span>
              为保住固定点「{titleOf(fixedId)} {fmtClock(present.showStartSeconds + fixedStartOf(fixedId))}」：
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
