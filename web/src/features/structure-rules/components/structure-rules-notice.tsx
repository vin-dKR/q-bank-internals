import type { JSX } from 'react';
import {
  structureRuleScope,
  type StructureDetectionContext,
  STRUCTURE_HEADING_LEVELS,
  structureExampleOutput,
} from '@ingest/contracts';
import { useResolvedStructureRule } from '../hooks/use-structure-rules.js';

export function StructureRulesNotice({
  context,
}: {
  context: StructureDetectionContext;
}): JSX.Element {
  const scope = structureRuleScope(context);
  const result = useResolvedStructureRule(context);
  const rule = result.data;
  return (
    <div className="rounded border border-line bg-surface p-2 text-xs text-ink-2">
      {!scope ? (
        <p className="m-0">
          Choose a source and {context.source === 'pyq' ? 'exam' : 'provider'} to load its heading
          examples.
        </p>
      ) : result.isPending ? (
        <p className="m-0">Loading heading examples for {scope.provider}…</p>
      ) : result.isError ? (
        <p role="alert" className="m-0 text-bad">
          Could not load heading examples. {result.error.message}
        </p>
      ) : rule ? (
        <details>
          <summary className="cursor-pointer font-medium">
            Heading rules: {rule.provider} · {rule.source}
          </summary>
          <ul className="my-2 list-disc space-y-1 pl-4">
            {STRUCTURE_HEADING_LEVELS.map((level) => (
              <li key={level}>
                {level}: {rule.examples[level] || '(no example)'}{' '}
                {rule.examples[level]
                  ? `→ ${structureExampleOutput(rule, level) || '(blank)'}`
                  : ''}
              </li>
            ))}
          </ul>
          {rule.notes ? <p className="whitespace-pre-wrap">{rule.notes}</p> : null}
        </details>
      ) : (
        <p className="m-0">
          No saved heading examples for {scope.provider} · {scope.source}. Detection uses the
          general rules.
        </p>
      )}
      <a
        href="/structure-rules"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-brand"
      >
        Set example rules ↗
      </a>
    </div>
  );
}
