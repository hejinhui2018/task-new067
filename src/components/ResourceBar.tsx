import { useState } from 'react';
import { useRundown } from '../store/RundownContext';
import { uid } from '../store/reducer';
import type { ResourceKind } from '../types';

/** 共享资源台账条：登记跨场地复用的嘉宾、主持人与设备，删除时自动从环节解绑 */
export function ResourceBar() {
  const { present, dispatch } = useRundown();
  const resources = present.resources ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ResourceKind>('person');

  const usage = (id: string) => present.segments.filter((s) => s.resourceIds?.includes(id)).length;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch({
      type: 'ADD_RESOURCE',
      resource: { id: uid(), name: trimmed, kind },
    });
    setName('');
    setAdding(false);
  };

  return (
    <section className="panel resource-bar">
      <span className="rb-title">共享资源台账</span>
      <span className="rb-hint muted">同一资源同一时刻只能被一个场地占用</span>
      <div className="rb-chips">
        {resources.map((r) => (
          <span key={r.id} className={`res-chip rc-${r.kind}`}>
            {r.kind === 'person' ? '👤' : '🚚'} {r.name}
            <span className="rc-usage mono" title="被多少个环节引用">
              ×{usage(r.id)}
            </span>
            <button
              className="rc-del"
              title="删除资源（自动从所有环节解绑，可撤销）"
              onClick={() => dispatch({ type: 'DELETE_RESOURCE', id: r.id })}
            >
              ×
            </button>
          </span>
        ))}
        {resources.length === 0 && <span className="muted">尚未登记共享资源</span>}
      </div>
      {adding ? (
        <span className="rb-add-form">
          <input
            className="inline"
            placeholder="资源名称，如 嘉宾·陈默"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <select className="btn" value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)}>
            <option value="person">人员</option>
            <option value="equipment">设备</option>
          </select>
          <button className="btn btn-primary" onClick={submit}>
            添加
          </button>
          <button className="btn" onClick={() => setAdding(false)}>
            取消
          </button>
        </span>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ 登记资源
        </button>
      )}
    </section>
  );
}
