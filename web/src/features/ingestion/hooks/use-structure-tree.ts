import { useCallback, useMemo, useState } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import { emptyMetadata, type ChapterMetadataDraft } from '../types/chapter-group.js';
import type {
  MaterializedArtifact,
  NodeLevel,
  StructureNode,
  StructureTree,
} from '../types/structure-node.js';
import {
  addChild,
  bindArtifact as bindArtifactIn,
  newNode,
  removeNode as removeNodeIn,
  unbindArtifact as unbindArtifactIn,
  updateNode,
} from '../lib/structure-tree.js';

export type StructureTreeController = {
  tree: StructureTree;
  /** True once the operator has built any structure — drives the empty state. */
  hasNodes: boolean;
  setMetadata: (patch: Partial<ChapterMetadataDraft>) => void;
  /** Add a child node under `parentId`, or a top-level node when null. Returns the new node's id. */
  addNode: (parentId: string | null, level: NodeLevel | null, label?: string) => string;
  renameNode: (id: string, label: string) => void;
  setNodeLevel: (id: string, level: NodeLevel | null) => void;
  setQuestionType: (id: string, questionType: string) => void;
  removeNode: (id: string) => void;
  bindArtifact: (leafId: string, kind: ChapterKind, artifact: MaterializedArtifact) => void;
  unbindArtifact: (leafId: string, kind: ChapterKind) => void;
  reset: () => void;
};

/**
 * The durable structure tree for one chapter. Its state is entirely independent of the working
 * document — nothing here reacts to a PDF edit, which is the whole point: cutting or replacing the
 * PDF on the left leaves this tree (and its already-materialized bindings) untouched.
 */
export function useStructureTree(): StructureTreeController {
  const [metadata, setMeta] = useState<ChapterMetadataDraft>(emptyMetadata);
  const [nodes, setNodes] = useState<StructureNode[]>([]);

  const setMetadata = useCallback((patch: Partial<ChapterMetadataDraft>): void => {
    setMeta((prev) => ({ ...prev, ...patch }));
  }, []);

  const addNode = useCallback(
    (parentId: string | null, level: NodeLevel | null, label = ''): string => {
      const node = newNode(level, label);
      setNodes((prev) => (parentId === null ? [...prev, node] : addChild(prev, parentId, node)));
      return node.id;
    },
    [],
  );

  const renameNode = useCallback((id: string, label: string): void => {
    setNodes((prev) => updateNode(prev, id, (node) => ({ ...node, label })));
  }, []);

  const setNodeLevel = useCallback((id: string, level: NodeLevel | null): void => {
    setNodes((prev) => updateNode(prev, id, (node) => ({ ...node, level })));
  }, []);

  const setQuestionType = useCallback((id: string, questionType: string): void => {
    setNodes((prev) => updateNode(prev, id, (node) => ({ ...node, questionType })));
  }, []);

  const removeNode = useCallback((id: string): void => {
    setNodes((prev) => removeNodeIn(prev, id));
  }, []);

  const bindArtifact = useCallback(
    (leafId: string, kind: ChapterKind, artifact: MaterializedArtifact): void => {
      setNodes((prev) => bindArtifactIn(prev, leafId, kind, artifact));
    },
    [],
  );

  const unbindArtifact = useCallback((leafId: string, kind: ChapterKind): void => {
    setNodes((prev) => unbindArtifactIn(prev, leafId, kind));
  }, []);

  const reset = useCallback((): void => {
    setMeta(emptyMetadata());
    setNodes([]);
  }, []);

  const tree = useMemo<StructureTree>(() => ({ metadata, nodes }), [metadata, nodes]);

  return {
    tree,
    hasNodes: nodes.length > 0,
    setMetadata,
    addNode,
    renameNode,
    setNodeLevel,
    setQuestionType,
    removeNode,
    bindArtifact,
    unbindArtifact,
    reset,
  };
}
