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
  type StructureExpectedOutputs,
  structureHierarchy,
  type StructureHierarchyLevel,
} from '@ingest/contracts';
import { Combobox, Button, LoadingState, useConfirm, IconTrash } from '../../../shared/ui/index.js';
import { useDictionary } from '../../taxonomy/index.js';
import {
  useStructureRules,
  useSaveStructureRule,
  useDeleteStructureRule,
  useStructureRulesWriting,
} from '../hooks/use-structure-rules.js';

const SOURCE_LABELS = { module: 'Module', textbook: 'Textbook', pyq: 'PYQ' };
const FIELDS = [
  { key: 'section', placeholder: 'Exercise-1' },
  {
    key: 'part',
    placeholder: 'PART I: SUBJECTIVE QUESTIONS',
  },
  {
    key: 'topic',
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
  const initialHierarchy = structureHierarchy(saved).map((level) => ({
    ...level,
    expectedOutput: level.expectedOutput ?? structureLabelFromHeading(level.id, level.example),
  }));
  const [hierarchy, setHierarchy] = useState<StructureHierarchyLevel[]>(initialHierarchy);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const save = useSaveStructureRule();
  const writing = useStructureRulesWriting();
  const examples: StructureExamples = { ...EMPTY_STRUCTURE_EXAMPLES };
  const expectedOutputs: StructureExpectedOutputs = { section: null, part: null, topic: null };
  for (const field of FIELDS) {
    const level = hierarchy.find((item) => item.id === field.key);
    examples[field.key] = level?.example ?? '';
    expectedOutputs[field.key] = level?.example.trim() ? level.expectedOutput : null;
  }
  const input = {
    ...scope,
    examples,
    expectedOutputs,
    hierarchy: hierarchy.map((level) => ({
      ...level,
      expectedOutput: level.example.trim() ? level.expectedOutput : null,
    })),
    notes,
  };
  const checked = SaveStructureRuleSchema.safeParse(input);
  const dirty =
    JSON.stringify({ hierarchy, notes }) !==
    JSON.stringify({
      hierarchy: initialHierarchy,
      notes: saved?.notes ?? '',
    });
  const editLevel = (id: string, patch: Partial<StructureHierarchyLevel>): void => {
    setHierarchy((levels) =>
      levels.map((level) => (level.id === id ? { ...level, ...patch } : level)),
    );
  };
  const addLevel = (index: number): void => {
    let number = hierarchy.length + 1;
    while (hierarchy.some((level) => level.name === `Level ${String(number)}`)) number += 1;
    const level: StructureHierarchyLevel = {
      id: `level-${crypto.randomUUID()}`,
      name: `Level ${String(number)}`,
      example: '',
      expectedOutput: '',
    };
    setHierarchy((levels) => [...levels.slice(0, index), level, ...levels.slice(index)]);
  };
  const moveLevel = (index: number, direction: -1 | 1): void => {
    setHierarchy((levels) => {
      const moved = [...levels];
      const current = moved[index];
      const other = moved[index + direction];
      if (current && other) {
        moved[index] = other;
        moved[index + direction] = current;
      }
      return moved;
    });
  };
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
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
        <p className="m-0 text-sm font-semibold text-ink">Heading hierarchy</p>
        <p className="mb-3 mt-1 text-xs text-ink-2">
          Arrange levels from the main heading to the smallest subheading. Each name becomes a crop
          button.
        </p>
        <ol
          className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
          aria-label="Hierarchy order"
        >
          {hierarchy.map((level, index) => (
            <li key={level.id} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-3">
                  →
                </span>
              ) : null}
              <span className="rounded-lg border border-brand/20 bg-surface px-3 py-1.5 text-sm font-medium text-ink">
                <span className="mr-2 text-xs text-brand">{index + 1}</span>
                {level.name.trim() || 'Name this level'}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {hierarchy.map((level, index) => {
        const field = FIELDS.find((item) => item.key === level.id);
        return (
          <fieldset
            key={level.id}
            className="m-0 min-w-0 rounded-xl border border-line-strong bg-surface p-4"
          >
            <legend className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">
              Level {index + 1}
            </legend>
            <div className="mb-4 space-y-3">
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                <span className="font-medium text-ink">Level name</span>
                <input
                  type="text"
                  className="input w-full min-w-0"
                  aria-label={`Level ${String(index + 1)} name`}
                  value={level.name}
                  maxLength={60}
                  disabled={writing}
                  onChange={(event) => {
                    editLevel(level.id, { name: event.target.value });
                  }}
                />
                <span className="text-xs text-ink-3">
                  The name shown in heading cropping, such as Section, Part or Topic.
                </span>
              </label>
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-2"
                aria-label={`Actions for ${level.name}`}
              >
                <Button
                  size="xs"
                  aria-label={`Move ${level.name} up`}
                  disabled={writing || index === 0}
                  onClick={() => {
                    moveLevel(index, -1);
                  }}
                >
                  ↑ Move up
                </Button>
                <Button
                  size="xs"
                  aria-label={`Move ${level.name} down`}
                  disabled={writing || index === hierarchy.length - 1}
                  onClick={() => {
                    moveLevel(index, 1);
                  }}
                >
                  ↓ Move down
                </Button>
                <Button
                  size="xs"
                  disabled={writing || hierarchy.length >= 16}
                  onClick={() => {
                    addLevel(index);
                  }}
                >
                  Add above
                </Button>
                <Button
                  size="xs"
                  disabled={writing || hierarchy.length >= 16}
                  onClick={() => {
                    addLevel(index + 1);
                  }}
                >
                  Add below
                </Button>
                <Button
                  variant="danger"
                  size="xs"
                  aria-label={`Delete ${level.name} level`}
                  disabled={writing || hierarchy.length === 1}
                  onClick={() => {
                    setHierarchy((levels) => levels.filter((item) => item.id !== level.id));
                  }}
                >
                  Delete level
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                <span className="font-medium text-ink">Printed heading example</span>
                <input
                  type="text"
                  className="input w-full min-w-0"
                  aria-label={`${level.name} heading example`}
                  value={level.example}
                  placeholder={field?.placeholder ?? `e.g. ${level.name} heading as printed`}
                  maxLength={500}
                  disabled={writing}
                  onChange={(event) => {
                    const printed = event.target.value;
                    editLevel(level.id, {
                      example: printed,
                      expectedOutput:
                        level.expectedOutput === structureLabelFromHeading(level.id, level.example)
                          ? structureLabelFromHeading(level.id, printed)
                          : level.expectedOutput,
                    });
                  }}
                />
                <span className="text-xs text-ink-3">
                  Copy a heading exactly as it appears in the PDF.
                </span>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-sm">
                <span className="font-medium text-ink">Expected output</span>
                <input
                  type="text"
                  className="input w-full min-w-0"
                  aria-label={`${level.name} expected output`}
                  value={level.expectedOutput ?? ''}
                  placeholder={
                    field
                      ? structureLabelFromHeading(level.id, field.placeholder)
                      : 'e.g. cleaned heading label'
                  }
                  maxLength={500}
                  disabled={writing}
                  onChange={(event) => {
                    const output = event.target.value;
                    editLevel(level.id, { expectedOutput: output });
                  }}
                />
                <span className="text-xs text-ink-3">
                  The cleaned label you want in the structure.
                </span>
              </label>
            </div>
            <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs">
              <span className="font-semibold text-ink-2">Preview</span>
              {level.example.trim() ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="break-words rounded border border-line bg-surface px-2 py-1 text-ink">
                    {level.example}
                  </code>
                  <span aria-hidden="true" className="text-brand">
                    →
                  </span>
                  <code className="break-words rounded border border-brand/20 bg-brand/5 px-2 py-1 text-brand">
                    {level.expectedOutput || '(blank label)'}
                  </code>
                </div>
              ) : (
                <p className="mb-0 mt-1 text-ink-3">
                  Add a printed heading example to preview its output.
                </p>
              )}
            </div>
          </fieldset>
        );
      })}
      <Button
        className="self-start"
        disabled={writing || hierarchy.length >= 16}
        onClick={() => {
          addLevel(hierarchy.length);
        }}
      >
        + Add hierarchy level
      </Button>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Additional recognition rules <span className="font-normal text-ink-3">(optional)</span>
        </span>
        <textarea
          className="input w-full"
          rows={3}
          value={notes}
          maxLength={2000}
          disabled={writing}
          placeholder="e.g. Exercise headings start a Section. Section (A)/(B) headings within a Part are Topics."
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </label>
      <p className="m-0 text-xs text-ink-3">
        Expected output teaches AI how to format this example. Other headings use their own printed
        names and identifiers. Only printed headings create nodes; page assignments remain manual.
      </p>
      {save.isError ? (
        <p role="alert" className="error">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" type="submit" disabled={!checked.success || !dirty || writing}>
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
  const remove = useDeleteStructureRule();
  const writing = useStructureRulesWriting();
  const [confirm, confirmDialog] = useConfirm();
  const deleteRule = async (rule: StructureRule): Promise<void> => {
    if (writing) return;
    const confirmed = await confirm({
      title: `Delete ${rule.provider} rule set?`,
      body: `This removes the entire saved hierarchy, heading examples, expected outputs and notes for ${rule.provider} (${SOURCE_LABELS[rule.source]}). New detections will use the default Section → Part → Topic hierarchy.`,
      confirmLabel: 'Delete rule set',
      tone: 'danger',
    });
    if (confirmed) remove.mutate({ source: rule.source, provider: rule.provider });
  };
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
            <div
              key={structureRuleScopeKey(rule)}
              className={`flex items-center gap-2 rounded-lg border ${structureRuleScopeKey(rule) === structureRuleScopeKey(scope) ? 'border-brand bg-brand/5' : 'border-line'}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 rounded-lg p-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                title={rule.provider}
                disabled={writing}
                onClick={() => {
                  setSource(rule.source);
                  setProvider(rule.provider);
                }}
              >
                <span className="block text-sm font-medium">{rule.provider}</span>
                <span className="text-xs text-ink-3">
                  {SOURCE_LABELS[rule.source]} · {structureHierarchy(rule).length} levels
                </span>
              </button>
              <Button
                variant="danger"
                size="xs"
                className="mr-3 shrink-0"
                aria-label={`Delete ${rule.provider} ${SOURCE_LABELS[rule.source]} rule set`}
                disabled={writing}
                onClick={() => {
                  void deleteRule(rule);
                }}
              >
                <IconTrash />
                {remove.isPending &&
                structureRuleScopeKey(remove.variables) === structureRuleScopeKey(rule)
                  ? 'Deleting…'
                  : 'Delete'}
              </Button>
            </div>
          ))
        )}
      </aside>
      {confirmDialog}
    </div>
  );
}
