import { useMemo, useState } from 'react';
import type { Passage } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { useUpdatePassage } from './use-questions.js';

/**
 * Local-first editing state for comprehension passages (BLA-125, v2). A passage is edited ONCE (the
 * group panel), its draft compared against the server row for dirtiness, and {@link PassageDrafts.save}
 * pushes only the dirty ones through the single-passage PATCH — the successor to the old N-sibling
 * passage fan-out. Keyed by passageId; text-only for now (the shared image is a fast follow-up).
 */
export type PassageDrafts = {
  /** The passage's working text: the local draft when one exists, else the server truth. */
  textFor: (passageId: string) => string;
  setText: (passageId: string, text: string) => void;
  /** Passages whose draft differs from the server — the only ones a save ever sends. */
  dirtyIds: ReadonlySet<string>;
  savingIds: ReadonlySet<string>;
  isSaving: boolean;
  /** Push the dirty passages among `passageIds`; a failure is toasted and the draft kept. */
  save: (passageIds: readonly string[]) => Promise<void>;
};

export function usePassageDrafts(
  documentId: string,
  passages: Passage[] | undefined,
): PassageDrafts {
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const update = useUpdatePassage(documentId);
  const { error } = useToast();

  // Drafts belong to one document; picking another unit must never carry edits across.
  const [scope, setScope] = useState(documentId);
  if (scope !== documentId) {
    setScope(documentId);
    setDrafts(new Map());
    setSavingIds(new Set());
  }

  const serverText = useMemo(() => {
    const map = new Map<string, string>();
    for (const passage of passages ?? []) map.set(passage.id, passage.text);
    return map;
  }, [passages]);

  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, text] of drafts) {
      const server = serverText.get(id);
      if (server !== undefined && server !== text) ids.add(id);
    }
    return ids;
  }, [drafts, serverText]);

  const textFor = (passageId: string): string =>
    drafts.get(passageId) ?? serverText.get(passageId) ?? '';

  const setText = (passageId: string, text: string): void => {
    setDrafts((prev) => new Map(prev).set(passageId, text));
  };

  const save = async (passageIds: readonly string[]): Promise<void> => {
    const targets = passageIds.filter((id) => dirtyIds.has(id) && drafts.has(id));
    if (targets.length === 0) return;
    setSavingIds((prev) => new Set([...prev, ...targets]));
    let failures = 0;
    for (const id of targets) {
      const text = drafts.get(id);
      if (text === undefined) continue;
      try {
        await update.mutateAsync({ id, patch: { text } });
        // Clear the draft only if the operator has not kept typing while the save was in flight.
        setDrafts((prev) => {
          if (prev.get(id) !== text) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      } catch {
        failures += 1;
      }
    }
    setSavingIds((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.delete(id);
      return next;
    });
    if (failures > 0) {
      error('Passage save failed', `${String(failures)} passage(s) could not be saved — they stay edited.`);
    }
  };

  return { textFor, setText, dirtyIds, savingIds, isSaving: update.isPending, save };
}
