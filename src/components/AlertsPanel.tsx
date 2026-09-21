import { fmtClock, fmtDur } from '../engine/time';
import { useRundown } from '../store/RundownContext';
import type { Adjustment, Conflict } from '../engine/schedule';
import type { ResourceConflict } from '../engine/resources';
import type { RundownAction } from '../store/reducer';
import type { VenueId } from '../types';

const VENUE_NAME: Record<VenueId, string> = { A: '主舞台', B: '访谈间' };

/** 固定点冲突横幅（各场地内消化不下的超时） */
function FixedConflictBanner({ conflict, venueId }: { conflict: Conflict; venueId: VenueId }) {
  const { present } = useRundown();
  const titleOf = (id: string) => present.segments.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="banner banner-red" role="alert">
      <strong>⚠ {VENUE_NAME[venueId]}固定点冲突</strong>
      <span>
        「{conflict.fixedTitle.replace(/^主舞台·|^访谈间·/, '')}」须{' '}
        {fmtClock(present.showStartSeconds + conflict.fixedStartOffset)} 准点开播，
        前序内容超时 {fmtDur(conflict.overflow)}；缓冲与可压缩空间已消化 {fmtDur(conflict.absorbed)}，
        仍超出 <b>{fmtDur(conflict.overBy)}</b>
        {conflict.overflowingSegmentIds.length > 0 &&
          `（涉及：${conflict.overflowingSegmentIds.map(titleOf).join('、')}）`}
        。请缩短前序环节或后移固定点——系统不会悄悄越过固定点，也不会整线顺延另一场地。
      </span>
    </div>
  );
}

/** 消化明细横幅（琥珀色） */
function AbsorbedBanner({ venueId, fixedId, list }: { venueId: VenueId; fixedId: string; list: Adjustment[] }) {
  const { present } = useRundown();
  const titleOf = (id: string) => present.segments.find((s) => s.id === id)?.title ?? id;
  const fixedStartOf = (id: string) => present.segments.find((s) => s.id === id)?.fixedStartOffset ?? 0;
  const total = list.reduce((sum, a) => sum + a.absorbed, 0);
  return (
    <div key={`${venueId}-${fixedId}`} className="banner banner-amber">
      <strong>✓ {VENUE_NAME[venueId]}已自动消化超时 {fmtDur(total)}</strong>
      <span>
        为保住固定点「{titleOf(fixedId)} {fmtClock(present.showStartSeconds + fixedStartOf(fixedId))}」：
        {list
          .map((a) => `「${a.title}」${fmtDur(a.from)} → ${fmtDur(a.to)}（-${fmtDur(a.absorbed)}）`)
          .join('，')}
        。消化只发生在{VENUE_NAME[venueId]}同一区段内，不跨固定点、不跨场地倒灌。
      </span>
    </div>
  );
}

const TONE_BTN: Record<string, string> = {
  compress: 'advice-btn advice-compress',
  delay: 'advice-btn advice-delay',
  move: 'advice-btn advice-move',
  fix: 'advice-btn advice-fix',
  unlock: 'advice-btn advice-unlock',
};

/** 资源碰撞横幅：碰撞区间、涉及环节、可行建议（一键采用，记入撤销栈） */
function ResourceConflictBanner({ conflict }: { conflict: ResourceConflict }) {
  const { present, dispatch } = useRundown();
  const venueTag = (v: VenueId) => VENUE_NAME[v];
  const partyLine = (i: 0 | 1) => {
    const p = conflict.parties[i];
    return (
      <span className="conflict-party">
        <span className={`venue-dot vd-${p.venueId}`} />
        {venueTag(p.venueId)}「{p.title}」
        <span className="mono">
          {fmtClock(present.showStartSeconds + p.startOffset)}–{fmtClock(present.showStartSeconds + p.endOffset)}
        </span>
        {p.locked && <span className="lock-tag">已执行</span>}
        {p.kind === 'fixed' && <span className="fixed-tag">⚓固定</span>}
      </span>
    );
  };

  const apply = (action: RundownAction) => dispatch(action);
  const feasible = conflict.advices.filter((a) => a.feasible);
  const blocked = conflict.advices.filter((a) => !a.feasible);

  return (
    <div className="banner banner-red resource-banner" role="alert">
      <div className="rb-head">
        <strong>⚠ 跨场地资源冲突：{conflict.resourceName}</strong>
        <span className="rb-window mono">
          碰撞区间 {fmtClock(present.showStartSeconds + conflict.startOffset)}–
          {fmtClock(present.showStartSeconds + conflict.endOffset)}（{fmtDur(conflict.duration)}）
        </span>
      </div>
      <div className="rb-parties">
        {partyLine(0)}
        <span className="rb-x">⨯</span>
        {partyLine(1)}
      </div>
      <div className="rb-advices">
        <span className="rb-advices-label">
          {conflict.unsolvable ? '当前约束下无可行调整：' : '可行调整（点击采用，可撤销）：'}
        </span>
        {feasible.map((a) => (
          <button key={a.id} className={TONE_BTN[a.tone]} title={a.detail} onClick={() => apply(a.action!)}>
            {a.summary}
          </button>
        ))}
        {conflict.unsolvable && <span className="rb-blocked-reason">{conflict.unsolvableReason}</span>}
        {blocked
          .filter((a) => a.kind !== 'unlock-row')
          .map((a) => (
            <span key={a.id} className="advice-blocked" title={a.blockedReason}>
              {a.summary}（{a.blockedReason}）
            </span>
          ))}
      </div>
    </div>
  );
}

/** 告警区：资源碰撞优先，其次固定点冲突与消化明细 */
export function AlertsPanel() {
  const { show } = useRundown();
  const hasAnything =
    show.resourceConflicts.length > 0 ||
    show.venues.some((v) => v.schedule.conflicts.length > 0 || v.schedule.adjustments.length > 0);
  if (!hasAnything) return null;

  return (
    <section className="alerts">
      {show.resourceConflicts.map((c) => (
        <ResourceConflictBanner key={c.id} conflict={c} />
      ))}
      {show.venues.flatMap((v) =>
        v.schedule.conflicts.map((c) => (
          <FixedConflictBanner key={`${v.venueId}-${c.fixedSegmentId}`} conflict={c} venueId={v.venueId} />
        )),
      )}
      {show.venues.flatMap((v) => {
        const groups = new Map<string, Adjustment[]>();
        for (const a of v.schedule.adjustments) {
          const list = groups.get(a.fixedSegmentId) ?? [];
          list.push(a);
          groups.set(a.fixedSegmentId, list);
        }
        return [...groups.entries()].map(([fixedId, list]) => (
          <AbsorbedBanner key={`${v.venueId}-${fixedId}`} venueId={v.venueId} fixedId={fixedId} list={list} />
        ));
      })}
    </section>
  );
}
