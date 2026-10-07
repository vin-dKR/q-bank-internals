import type { StructureNode } from '../types/structure-node.js';
import type { PdfInput } from './cut-pdf.js';
import { configPageBindings, nodesFromConfig, type ConfigNode } from './structure-config.js';
import { materializePageGroups } from './materialize-slice.js';

/** Build fresh nodes with immutable question PDFs; supporting attachments remain manual. */
export async function materializeStructureQuestions(
  pdfBytes: PdfInput,
  configs: ConfigNode[],
): Promise<StructureNode[]> {
  const nodes = nodesFromConfig(configs, false);
  const bindings = configPageBindings(configs, nodes).filter(
    (binding) => binding.kind === 'question',
  );
  const artifacts = await materializePageGroups(
    pdfBytes,
    bindings.map((binding) => binding.pages),
  );
  const byLeaf = new Map(bindings.map((binding, index) => [binding.leafId, artifacts[index]]));
  const attach = (forest: StructureNode[]): void => {
    for (const node of forest) {
      const artifact = byLeaf.get(node.id);
      // These nodes were just created here; no live tree is changed before every slice succeeds.
      if (artifact) node.bindings = { question: artifact };
      attach(node.children);
    }
  };
  attach(nodes);
  return nodes;
}
