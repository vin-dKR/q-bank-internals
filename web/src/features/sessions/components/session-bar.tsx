import { type JSX, useEffect, useState } from 'react';
import { useCurrentSession } from '../../../shared/lib/current-session.js';
import { IconPlus, StatusBadge } from '../../../shared/ui/index.js';
import { useCreateSession, useSessions, useUpdateSession } from '../hooks/use-sessions.js';

/** Bar states: showing the active session, renaming it, or naming a brand-new one. */
type Mode = 'idle' | 'rename' | 'new';

/**
 * The Phase-1 working-session bar. Sessions are never created behind your back — you start (or
 * switch to) one explicitly and give it a name. The active session is remembered across pages so
 * the Phase 1 → 2 → 3 flow stays connected; you can rename it or open a fresh named one any time.
 */
export function SessionBar({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const sessions = useSessions();
  const create = useCreateSession();
  const update = useUpdateSession();
  const [currentId, setCurrentId] = useCurrentSession();
  const [mode, setMode] = useState<Mode>('idle');
  const [label, setLabel] = useState('');

  const items = sessions.data?.items ?? [];
  const active = items.find((session) => session.id === currentId) ?? null;

  // Drop a stored id that points at a session that no longer exists (deleted, or a wiped DB), so it
  // can't linger as a phantom upload target. Only once the list has actually loaded, so a freshly
  // created session (already seeded into the cache) is never mistaken for stale.
  useEffect(() => {
    if (sessions.isPending || sessions.isFetching) return;
    if (currentId !== null && !items.some((session) => session.id === currentId)) {
      setCurrentId(null);
    }
  }, [sessions.isPending, sessions.isFetching, currentId, items, setCurrentId]);

  const cancel = (): void => { setMode('idle'); setLabel(''); };

  const beginRename = (): void => {
    if (!active) return;
    setLabel(active.label);
    setMode('rename');
  };

  const beginNew = (): void => { setLabel(''); setMode('new'); };

  const saveRename = (): void => {
    const name = label.trim();
    if (active && name && name !== active.label) {
      update.mutate({ id: active.id, patch: { label: name } });
    }
    cancel();
  };

  const createNamed = (): void => {
    const name = label.trim();
    if (!name) return;
    create.mutate(
      { label: name, autoRun: false },
      { onSuccess: (session) => { setCurrentId(session.id); cancel(); } },
    );
  };

  const editing = mode === 'rename' && active !== null;
  const naming = mode === 'new';
  const submit = naming ? createNamed : saveRename;

  // Compact variant: a single slim row (switch + status + New) for the crop workspace top bar,
  // where the full session card would waste vertical space the PDF needs.
  if (compact) {
    return (
      <div className="session-bar--compact">
        {editing || naming ? (
          <div className="row">
            <input
              type="text"
              value={label}
              autoFocus
              placeholder={naming ? 'Name this session' : 'Session name'}
              onChange={(event) => { setLabel(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') cancel();
              }}
              className="min-w-0 flex-1 max-w-[220px]"
            />
            <button
              type="button"
              className="btn btn--primary btn--xs"
              disabled={!label.trim() || create.isPending}
              onClick={submit}
            >
              {naming ? (create.isPending ? 'Creating…' : 'Create') : 'Save'}
            </button>
            <button type="button" className="btn btn--xs" onClick={cancel}>Cancel</button>
          </div>
        ) : (
          <>
            <select
              value={active ? currentId ?? '' : ''}
              onChange={(event) => { setCurrentId(event.target.value); setMode('idle'); }}
            >
              <option value="" disabled>Switch session…</option>
              {items.map((session) => (
                <option key={session.id} value={session.id}>{session.label}</option>
              ))}
            </select>
            {active ? (
              <StatusBadge status={active.status} />
            ) : (
              <span className="muted">No session</span>
            )}
            <button type="button" className="btn btn--ghost btn--xs" disabled={create.isPending} onClick={beginNew}>
              <IconPlus /> New
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="session-bar">
      <div className="session-bar__main">
        <span className="session-bar__eyebrow">Working session</span>
        {editing || naming ? (
          <div className="row">
            <input
              type="text"
              value={label}
              autoFocus
              placeholder={naming ? 'Name this session' : 'Session name'}
              onChange={(event) => { setLabel(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') cancel();
              }}
              className="min-w-0 flex-1 max-w-xs"
            />
            <button
              type="button"
              className="btn btn--primary btn--xs"
              disabled={!label.trim() || create.isPending}
              onClick={submit}
            >
              {naming ? (create.isPending ? 'Creating…' : 'Create') : 'Save'}
            </button>
            <button type="button" className="btn btn--xs" onClick={cancel}>
              Cancel
            </button>
          </div>
        ) : active ? (
          <div className="session-bar__title">
            <strong>{active.label}</strong>
            <StatusBadge status={active.status} />
            <button type="button" className="btn btn--ghost btn--xs" onClick={beginRename}>
              Rename
            </button>
          </div>
        ) : (
          <div className="session-bar__title">
            <span className="muted">No active session — create or pick one to start.</span>
          </div>
        )}
      </div>

      <div className="row flex-nowrap">
        <select
          value={active ? currentId ?? '' : ''}
          className="w-auto min-w-[180px] max-w-[260px]"
          onChange={(event) => { setCurrentId(event.target.value); setMode('idle'); }}
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
        <button
          type="button"
          className="btn"
          disabled={naming || create.isPending}
          onClick={beginNew}
        >
          <IconPlus /> New
        </button>
      </div>
    </div>
  );
}
