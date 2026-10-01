import { useState, type JSX } from 'react';
import {
  EMPTY_STRUCTURE_EXAMPLES,
  SaveStructureRuleSchema,
  StructureRuleSourceSchema,
  KNOWN_SOURCES,
  structureRuleScopeKey,
  structureLabelFromHeading,
  type StructureRule,
  type StructureRuleSource,
  type StructureRuleScope,
  type StructureExamples,
} from '@ingest/contracts';
import { Combobox, Button, LoadingState } from '../../../shared/ui/index.js';
import { useDictionary } from '../../taxonomy/index.js';
import { useStructureRules, useSaveStructureRule } from '../hooks/use-structure-rules.js';

const SOURCE_LABELS = { module: 'Module', textbook: 'Textbook', pyq: 'PYQ' };
const FIELDS = [
  { key: 'section', title: 'What does a Section heading look like?', placeholder: 'Exercise-1' },
  {
    key: 'part',
    title: 'What does a Part heading look like?',
    placeholder: 'PART I: SUBJECTIVE QUESTIONS',
  },
  {
    key: 'topic',
    title: 'What does a Topic heading look like?',
    placeholder: 'Section (A): Polymers',
  },
] as const;

function RuleForm({
  scope,
  saved,
}: {
  scope: StructureRuleScope;
  saved: StructureRule | undefined;
}): JSX.Element {
  const [examples, setExamples] = useState(saved?.examples ?? { ...EMPTY_STRUCTURE_EXAMPLES });
  const initialOutputs: StructureExamples = {
    section:
      saved?.expectedOutputs?.section ??
      structureLabelFromHeading('section', saved?.examples.section ?? ''),
    part:
      saved?.expectedOutputs?.part ?? structureLabelFromHeading('part', saved?.examples.part ?? ''),
    topic:
      saved?.expectedOutputs?.topic ??
      structureLabelFromHeading('topic', saved?.examples.topic ?? ''),
  };
  const [expectedOutputs, setExpectedOutputs] = useState(initialOutputs);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const save = useSaveStructureRule();
  const input = {
    ...scope,
    examples,
    expectedOutputs: {
      section: examples.section.trim() ? expectedOutputs.section : expectedOutputs.section || null,
      part: examples.part.trim() ? expectedOutputs.part : expectedOutputs.part || null,
      topic: examples.topic.trim() ? expectedOutputs.topic : expectedOutputs.topic || null,
    },
    notes,
  };
  const checked = SaveStructureRuleSchema.safeParse(input);
  const dirty =
    JSON.stringify({ examples, expectedOutputs, notes }) !==
    JSON.stringify({
      examples: saved?.examples ?? EMPTY_STRUCTURE_EXAMPLES,
      expectedOutputs: initialOutputs,
      notes: saved?.notes ?? '',
    });
  return (
    <form
      className="card flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (checked.success) save.mutate(checked.data);
      }}
    >
      <div>
        <h2 className="m-0 text-lg font-semibold">
          {scope.provider.trim() || 'Choose a provider'} · {SOURCE_LABELS[scope.source]}
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          {saved ? 'Saved examples are loaded below.' : 'This provider has no saved examples yet.'}{' '}
          Changes apply to the next detection.
        </p>
      </div>
      {FIELDS.map((field) => (
        <fieldset key={field.key} className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 text-sm font-medium">{field.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2 text-sm">
              <span>Printed heading example</span>
              <input
                type="text"
                aria-label={`${field.key} heading example`}
                value={examples[field.key]}
                placeholder={field.placeholder}
                maxLength={500}
                disabled={save.isPending}
                onChange={(event) => {
                  const printed = event.target.value;
                  setExpectedOutputs((previous) => ({
                    ...previous,
                    [field.key]:
                      previous[field.key] ===
                      structureLabelFromHeading(field.key, examples[field.key])
                        ? structureLabelFromHeading(field.key, printed)
                        : previous[field.key],
                  }));
                  setExamples((previous) => ({ ...previous, [field.key]: printed }));
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-sm">
              <span>Expected output</span>
              <input
                type="text"
                aria-label={`${field.key} expected output`}
                value={expectedOutputs[field.key]}
                placeholder={structureLabelFromHeading(field.key, field.placeholder)}
                maxLength={500}
                disabled={save.isPending}
                onChange={(event) => {
                  const output = event.target.value;
                  setExpectedOutputs((previous) => ({ ...previous, [field.key]: output }));
                }}
              />
            </label>
          </div>
          <p className="mb-0 mt-2 text-xs text-ink-3">
            Example: <code>{examples[field.key] || '(no heading)'}</code> →{' '}
            <code>{expectedOutputs[field.key] || '(blank)'}</code>
          </p>
        </fieldset>
      ))}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Additional recognition rules <span className="font-normal text-ink-3">(optional)</span>
        </span>
        <textarea
          className="input w-full"
          rows={3}
          value={notes}
          maxLength={2000}
          disabled={save.isPending}
          placeholder="e.g. Exercise headings start a Section. Section (A)/(B) headings within a Part are Topics."
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </label>
      <p className="m-0 text-xs text-ink-3">
        Expected output teaches AI how to format this example. Other headings use their own printed
        names and identifiers. Missing Topic names stay blank; page assignments remain manual.
      </p>
      {save.isError ? (
        <p role="alert" className="error">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!checked.success || !dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save example rules'}
        </Button>
        {dirty ? (
          <span className="text-xs text-ink-3">Unsaved changes</span>
        ) : saved ? (
          <span className="text-xs text-ink-3">Saved</span>
        ) : null}
      </div>
      {!checked.success && scope.provider.trim() && dirty ? (
        <p className="m-0 text-xs text-ink-3">{checked.error.issues[0]?.message}</p>
      ) : null}
    </form>
  );
}

export function StructureRulesSettings(): JSX.Element {
  const [source, setSource] = useState<StructureRuleSource>('module');
  const [provider, setProvider] = useState('');
  const rules = useStructureRules();
  const modules = useDictionary('module', {});
  const exams = useDictionary('exam', {});
  if (rules.isPending) return <LoadingState label="Loading structure rules…" />;
  if (rules.isError)
    return (
      <p role="alert" className="error">
        Could not load structure rules. {rules.error.message}
      </p>
    );
  const scope = { source, provider };
  const entries = rules.data;
  const saved = entries.find(
    (rule) => structureRuleScopeKey(rule) === structureRuleScopeKey(scope),
  );
  const suggestions = [
    ...new Set([
      ...(source === 'pyq' ? (exams.data?.entries ?? []) : (modules.data?.entries ?? [])).map(
        (entry) => entry.name,
      ),
      ...entries.filter((rule) => rule.source === source).map((rule) => rule.provider),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="card grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Source
            <select
              className="input"
              value={source}
              onChange={(event) => {
                setSource(StructureRuleSourceSchema.parse(event.target.value));
                setProvider('');
              }}
            >
              {KNOWN_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            {source === 'module'
              ? 'Module'
              : source === 'textbook'
                ? 'Textbook / publisher'
                : 'Exam'}
            <Combobox
              value={provider}
              options={suggestions}
              onChange={setProvider}
              placeholder={
                source === 'module'
                  ? 'Choose or type Allen / PW / Resonance'
                  : source === 'textbook'
                    ? 'Choose or type a textbook / publisher'
                    : 'Choose or type an exam name'
              }
            />
          </label>
          <p className="m-0 text-xs text-ink-3 sm:col-span-2">
            Each source and provider has its own rules. Select the same source and name in Cut &amp;
            upload to use these examples automatically.
          </p>
        </div>
        <RuleForm
          key={structureRuleScopeKey(scope) + (saved?.updatedAt ?? '')}
          scope={scope}
          saved={saved}
        />
      </div>
      <aside className="card flex flex-col gap-3">
        <h2 className="m-0 text-base font-semibold">Saved rule sets</h2>
        {entries.length === 0 ? (
          <p className="m-0 text-sm text-ink-3">
            No examples saved yet. Choose a source and provider, then add its headings.
          </p>
        ) : (
          entries.map((rule) => (
            <button
              key={structureRuleScopeKey(rule)}
              type="button"
              className={`rounded-lg border p-3 text-left ${structureRuleScopeKey(rule) === structureRuleScopeKey(scope) ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'}`}
              onClick={() => {
                setSource(rule.source);
                setProvider(rule.provider);
              }}
            >
              <span className="block text-sm font-medium">{rule.provider}</span>
              <span className="text-xs text-ink-3">{SOURCE_LABELS[rule.source]}</span>
            </button>
          ))
        )}
      </aside>
    </div>
  );
}
