import { useCallback, useMemo, useReducer } from 'react';

/** One snapshot in the cut pipeline: the PDF bytes after a transform, plus a human label. */
export type DocumentVersion = {
  bytes: Uint8Array;
  label: string;
};

type State = {
  versions: DocumentVersion[];
  cursor: number; // index of the live version, or -1 before any document is loaded
};

type Action =
  | { type: 'reset'; bytes: Uint8Array; label: string }
  | { type: 'apply'; bytes: Uint8Array; label: string }
  | { type: 'revert' }
  | { type: 'redo' }
  | { type: 'clear' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return { versions: [{ bytes: action.bytes, label: action.label }], cursor: 0 };
    case 'apply': {
      // A new transform truncates any reverted-past versions, like a fresh edit after undo.
      const kept = state.versions.slice(0, state.cursor + 1);
      const versions = [...kept, { bytes: action.bytes, label: action.label }];
      return { versions, cursor: versions.length - 1 };
    }
    case 'revert':
      return state.cursor > 0 ? { ...state, cursor: state.cursor - 1 } : state;
    case 'redo':
      return state.cursor < state.versions.length - 1 ? { ...state, cursor: state.cursor + 1 } : state;
    case 'clear':
      return { versions: [], cursor: -1 };
    default:
      return state;
  }
}

export type WorkingDocument = {
  current: Uint8Array | null;
  /** Ordered labels of every version, for the pipeline breadcrumb. */
  steps: string[];
  stepIndex: number;
  reset: (bytes: Uint8Array, label?: string) => void;
  apply: (bytes: Uint8Array, label: string) => void;
  revert: () => void;
  redo: () => void;
  clear: () => void;
  canRevert: boolean;
  canRedo: boolean;
};

/**
 * A version stack of PDF byte-snapshots that backs the cut pipeline. Each applied mode pushes a new
 * version (which the preview renders as the "refreshed" PDF); Revert / Redo walk the stack. This is
 * deliberately separate from the line-level undo in {@link useSplitPoints}, which resets per apply.
 */
export function useWorkingDocument(): WorkingDocument {
  const [state, dispatch] = useReducer(reducer, { versions: [], cursor: -1 });

  const reset = useCallback((bytes: Uint8Array, label = 'original'): void => {
    dispatch({ type: 'reset', bytes, label });
  }, []);
  const apply = useCallback((bytes: Uint8Array, label: string): void => {
    dispatch({ type: 'apply', bytes, label });
  }, []);
  const revert = useCallback((): void => { dispatch({ type: 'revert' }); }, []);
  const redo = useCallback((): void => { dispatch({ type: 'redo' }); }, []);
  const clear = useCallback((): void => { dispatch({ type: 'clear' }); }, []);

  const current = state.cursor >= 0 ? (state.versions[state.cursor]?.bytes ?? null) : null;
  const steps = useMemo(() => state.versions.map((v) => v.label), [state.versions]);

  return {
    current,
    steps,
    stepIndex: state.cursor,
    reset,
    apply,
    revert,
    redo,
    clear,
    canRevert: state.cursor > 0,
    canRedo: state.cursor < state.versions.length - 1,
  };
}
