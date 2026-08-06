import { useCallback, useReducer } from 'react';
import type { SplitOrientation, SplitPoint, SplitPointsByPage } from '../types/split-point.js';

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type HistoryState = {
  past: SplitPointsByPage[];
  present: SplitPointsByPage;
  future: SplitPointsByPage[];
};

type Action =
  | { type: 'commit'; next: SplitPointsByPage }
  | { type: 'amend'; next: SplitPointsByPage }
  | { type: 'snapshot' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'commit':
      return { past: [...state.past, state.present], present: action.next, future: [] };
    case 'amend':
      return { ...state, present: action.next };
    case 'snapshot':
      return { past: [...state.past, state.present], present: state.present, future: [] };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (next === undefined) return state;
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
    }
    case 'reset':
      return { past: [], present: {}, future: [] };
    default:
      return state;
  }
}

export type SplitPointsController = {
  splitPoints: SplitPointsByPage;
  addSplit: (pageNumber: number, position: number, orientation: SplitOrientation) => void;
  beginMove: () => void;
  moveSplit: (splitId: string, newPosition: number) => void;
  removeSplit: (splitId: string) => void;
  clearPage: (pageNumber: number) => void;
  clearAll: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  totalSplits: number;
};

/**
 * Local reimplementation of the standalone cutter's split store (ingest keeps UI state in hooks,
 * not zustand), extended with per-gesture undo/redo history and bulk-clear helpers.
 */
export function useSplitPoints(): SplitPointsController {
  const [state, dispatch] = useReducer(reducer, { past: [], present: {}, future: [] });
  const { present } = state;

  const addSplit = useCallback(
    (pageNumber: number, position: number, orientation: SplitOrientation): void => {
      dispatch({
        type: 'commit',
        next: {
          ...present,
          [pageNumber]: [...(present[pageNumber] ?? []), { id: makeId(), position, orientation }],
        },
      });
    },
    [present],
  );

  const beginMove = useCallback((): void => {
    dispatch({ type: 'snapshot' });
  }, []);

  const moveSplit = useCallback(
    (splitId: string, newPosition: number): void => {
      const next: SplitPointsByPage = {};
      for (const [page, splits] of Object.entries(present)) {
        next[Number(page)] = splits.map((s: SplitPoint) =>
          s.id === splitId ? { ...s, position: newPosition } : s,
        );
      }
      dispatch({ type: 'amend', next });
    },
    [present],
  );

  const removeSplit = useCallback(
    (splitId: string): void => {
      const next: SplitPointsByPage = {};
      for (const [page, splits] of Object.entries(present)) {
        next[Number(page)] = splits.filter((s: SplitPoint) => s.id !== splitId);
      }
      dispatch({ type: 'commit', next });
    },
    [present],
  );

  const clearPage = useCallback(
    (pageNumber: number): void => {
      dispatch({ type: 'commit', next: { ...present, [pageNumber]: [] } });
    },
    [present],
  );

  const clearAll = useCallback((): void => {
    dispatch({ type: 'commit', next: {} });
  }, []);

  const reset = useCallback((): void => {
    dispatch({ type: 'reset' });
  }, []);

  const undo = useCallback((): void => {
    dispatch({ type: 'undo' });
  }, []);

  const redo = useCallback((): void => {
    dispatch({ type: 'redo' });
  }, []);

  const totalSplits = Object.values(present).reduce((sum, splits) => sum + splits.length, 0);

  return {
    splitPoints: present,
    addSplit,
    beginMove,
    moveSplit,
    removeSplit,
    clearPage,
    clearAll,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    totalSplits,
  };
}
