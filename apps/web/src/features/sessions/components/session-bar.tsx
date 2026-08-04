import { type JSX, useEffect, useRef, useState } from 'react';
import { useCurrentSession } from '../../../shared/lib/current-session.js';
import { StatusBadge } from '../../../shared/ui/index.js';
import { useCreateSession, useSessions, useUpdateSession } from '../hooks/use-sessions.js';

/**
 * The Phase-1 working-session bar. A session is created automatically the first time you arrive, so
 * there's no manual step — you just start cutting. You can rename it, switch to another, or start a
 * fresh one. The active session is remembered across pages so the flow stays connected.
 */
export function SessionBar(): JSX.Element {
  const sessions = useSessions();
  const create = useCreateSession();
  const update = useUpdateSession();
  const [currentId, setCurrentId] = useCurrentSession();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const creatingRef = useRef(false);

  const items = sessions.data?.items ?? [];
  const active = items.find((session) => session.id === currentId) ?? null;

  // Auto-create a session whenever there is no valid active one (first visit, or a stale stored id).
  useEffect(() => {
    if (sessions.isPending || creatingRef.current) return;
    const hasValid = currentId !== null && items.some((session) => session.id === currentId);
    if (hasValid) return;
    creatingRef.current = true;
    create.mutate(
      { autoRun: false },
      {
        onSuccess: (session) => { setCurrentId(session.id); creatingRef.current = false; },
        onError: () => { creatingRef.current = false; },
      },
    );
  }, [sessions.isPending, currentId, items, create, setCurrentId]);

  const startNew = (): void => {
    create.mutate(
      { autoRun: false }, { onSuccess: (session) => { setCurrentId(session.id); } });
  };

  const saveLabel = (): void => {
    if (active && label.trim() && label.trim() !== active.label) {
      update.mutate({ id: active.id, patch: { label: label.trim() } });
    }
    setEditing(false);
  };

  return (
    <div className="session-bar">
      <div className="session-bar__main">
        <span className="session-bar__eyebrow">Working session</span>
        {editing && active ? (
          <div className="row">
            <input
              type="text"
              value={label}
              autoFocus
              onChange={(event) => { setLabel(event.target.value); }}
              onKeyDown={(event) => { if (event.key === 'Enter') saveLabel(); }}
              style={{ maxWidth: 320 }}
            />
            <button type="button" className="btn btn--primary btn--xs" onClick={saveLabel}>
              Save
            </button>
            <button type="button" className="btn btn--xs" onClick={() => { setEditing(false); }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="session-bar__title">
            <strong>{active ? active.label : 'Creating session…'}</strong>
            {active ? <StatusBadge status={active.status} /> : null}
            {active ? (
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => { setLabel(active.label); setEditing(true); }}
              >
                Rename
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="row">
        <select
          value={currentId ?? ''}
          style={{ maxWidth: 260 }}
          onChange={(event) => { setCurrentId(event.target.value); }}
        >
          <option value="" disabled>
            Switch session…
          </option>
          {items.map((session) => (
            <option key={session.id} value={session.id}>
              {session.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={create.isPending} onClick={startNew}>
          ＋ New
        </button>
      </div>
    </div>
  );
}
