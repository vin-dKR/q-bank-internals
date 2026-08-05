import { useCallback, useReducer } from 'react';
import type { CropRect, ReflowBlock } from '../types/reflow-block.js';

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type State = {
  blocks: ReflowBlock[];
  activeId: string | null;
};

type Action =
  | { type: 'newBlock' }
  | { type: 'addCrop'; crop: CropRect }
  | { type: 'removeCrop'; blockId: string; index: number }
  | { type: 'removeBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; dir: -1 | 1 }
  | { type: 'setActive'; id: string }
  | { type: 'clear' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'newBlock': {
      const block: ReflowBlock = { id: makeId(), crops: [] };
      return { blocks: [...state.blocks, block], activeId: block.id };
    }
    case 'addCrop': {
      // A crop with no active block opens one, so the first drag just works.
      const blocks = [...state.blocks];
      let activeId = state.activeId;
      let target = blocks.find((b) => b.id === activeId);
      if (!target) {
        target = { id: makeId(), crops: [] };
        blocks.push(target);
        activeId = target.id;
      }
      const next = blocks.map((b) => (b.id === target.id ? { ...b, crops: [...b.crops, action.crop] } : b));
      return { blocks: next, activeId };
    }
    case 'removeCrop': {
      const blocks = state.blocks
        .map((b) =>
          b.id === action.blockId ? { ...b, crops: b.crops.filter((_c, i) => i !== action.index) } : b,
        )
        .filter((b) => b.crops.length > 0);
      const activeId = blocks.some((b) => b.id === state.activeId)
        ? state.activeId
        : (blocks[blocks.length - 1]?.id ?? null);
      return { blocks, activeId };
    }
    case 'removeBlock': {
      const blocks = state.blocks.filter((b) => b.id !== action.blockId);
      const activeId = blocks.some((b) => b.id === state.activeId)
        ? state.activeId
        : (blocks[blocks.length - 1]?.id ?? null);
      return { blocks, activeId };
    }
    case 'moveBlock': {
      // Block order is output-page order, so reordering here reorders the reflowed PDF.
      const from = state.blocks.findIndex((b) => b.id === action.blockId);
      const to = from + action.dir;
      if (from < 0 || to < 0 || to >= state.blocks.length) return state;
      const blocks = [...state.blocks];
      const [moved] = blocks.splice(from, 1);
      if (!moved) return state;
      blocks.splice(to, 0, moved);
      return { ...state, blocks };
    }
    case 'setActive':
      return { ...state, activeId: action.id };
    case 'clear':
      return { blocks: [], activeId: null };
    default:
      return state;
  }
}

export type ReflowController = {
  blocks: ReflowBlock[];
  activeId: string | null;
  newBlock: () => void;
  addCrop: (crop: CropRect) => void;
  removeCrop: (blockId: string, index: number) => void;
  removeBlock: (blockId: string) => void;
  moveBlock: (blockId: string, dir: -1 | 1) => void;
  setActive: (id: string) => void;
  clear: () => void;
  totalCrops: number;
};

/**
 * Store for the manual crop-and-stack reflow tool: the operator drags a box around a question and
 * another around its spilled options (even on the next page); crops collect into the active block,
 * and {@link applyReflow} later stacks each block onto one clean page.
 */
export function useReflowBlocks(): ReflowController {
  const [state, dispatch] = useReducer(reducer, { blocks: [], activeId: null });

  const newBlock = useCallback((): void => { dispatch({ type: 'newBlock' }); }, []);
  const addCrop = useCallback((crop: CropRect): void => { dispatch({ type: 'addCrop', crop }); }, []);
  const removeCrop = useCallback((blockId: string, index: number): void => {
    dispatch({ type: 'removeCrop', blockId, index });
  }, []);
  const removeBlock = useCallback((blockId: string): void => { dispatch({ type: 'removeBlock', blockId }); }, []);
  const moveBlock = useCallback((blockId: string, dir: -1 | 1): void => {
    dispatch({ type: 'moveBlock', blockId, dir });
  }, []);
  const setActive = useCallback((id: string): void => { dispatch({ type: 'setActive', id }); }, []);
  const clear = useCallback((): void => { dispatch({ type: 'clear' }); }, []);

  const totalCrops = state.blocks.reduce((sum, b) => sum + b.crops.length, 0);

  return {
    blocks: state.blocks,
    activeId: state.activeId,
    newBlock,
    addCrop,
    removeCrop,
    removeBlock,
    moveBlock,
    setActive,
    clear,
    totalCrops,
  };
}
