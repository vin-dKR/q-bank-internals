import type { JSX } from 'react';
import {
  structureRuleScope,
  type StructureDetectionContext,
  structureHierarchy,
  structureExampleOutput,
} from '@ingest/contracts';
import { useResolvedStructureRule } from '../hooks/use-structure-rules.js';
import { InfoButton } from '../../../shared/ui/index.js';

export function StructureRulesNotice({
  context,
}: {
  context: StructureDetectionContext;
}): JSX.Element {
  const scope = structureRuleScope(context);
  const result = useResolvedStructureRule(context);
  const rule = result.data;
  return (
    <div className="flex items-center gap-1 text-xs text-ink-2">
      <div className="flex items-center gap-1">
        <span className={result.isError ? 'text-bad' : 'font-medium'}>
          {result.isError
            ? 'Heading rules unavailable'
            : `Heading rules: ${rule?.provider ?? 'General'}`}
        </span>
        <InfoButton label="Heading rule details">
          {!scope ? (
            <p className="m-0">
              Choose a source and {context.source === 'pyq' ? 'exam' : 'provider'} to load its
              heading examples.
            </p>
          ) : result.isPending ? (
            <p className="m-0">Loading heading examples for {scope.provider}…</p>
          ) : result.isError ? (
            <p role="alert" className="m-0 text-bad">
              Could not load heading examples. {result.error.message}
            </p>
          ) : rule ? (
            <div>
              <p className="font-medium">
                Heading rules: {rule.provider} · {rule.source}
              </p>
              <ul className="my-2 list-disc space-y-1 pl-4">
                {structureHierarchy(rule).map((level) => (
                  <li key={level.id}>
                    {level.name}: {level.example || '(no example)'}{' '}
                    {level.example
                      ? `→ ${structureExampleOutput(rule, level.id) || '(blank)'}`
                      : ''}
                  </li>
                ))}
              </ul>
              {rule.notes ? <p className="whitespace-pre-wrap">{rule.notes}</p> : null}
            </div>
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
            className="mt-2 inline-block text-brand"
          >
            Edit rules ↗
          </a>
        </InfoButton>
      </div>
    </div>
  );
}
