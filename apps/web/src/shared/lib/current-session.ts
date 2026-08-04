import { useSyncExternalStore } from 'react';

/**
 * The "active session" the operator is working in, remembered across pages + reloads (localStorage)
 * so the Phase 1 → Phase 2 → Phase 3 flow stays connected. A tiny external store keeps every
 * component that reads it in sync.
 */
const KEY = 'ingest:currentSessionId';

let current: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
const listeners = new Set<() => void>();

function setCurrentSessionId(id: string | null): void {
  current = id;
  if (typeof localStorage !== 'undefined') {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  }
  listeners.forEach((notify) => { notify(); });
}

/** `[currentSessionId, setCurrentSessionId]` — the active session, synced everywhere. */
export function useCurrentSession(): [string | null, (id: string | null) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => current,
  );
  return [value, setCurrentSessionId];
}
