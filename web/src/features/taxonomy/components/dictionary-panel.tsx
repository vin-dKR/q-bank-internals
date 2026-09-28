import { type JSX, useMemo, useState } from 'react';
import type {
  CreateDictionaryEntry,
  DictionaryQuery,
  TaxonomyDimension,
  UpdateDictionaryEntry,
} from '@ingest/contracts';
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  IconLayers,
  IconPlus,
  IconSearch,
  IconX,
  Skeleton,
  useConfirm,
  useToast,
} from '../../../shared/ui/index.js';
import { type DimensionMeta } from '../lib/dimensions.js';
import {
  useCreateEntry,
  useDeleteEntry,
  useDictionary,
  useSeedDimension,
  useUpdateEntry,
} from '../hooks/use-taxonomy.js';
import { DICT_COL, DictionaryRow } from './dictionary-row.js';

/** Human message from a thrown ApiError-or-Error, for toasts. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * The manager for one taxonomy dimension: a description + count header, search, a parent-scope filter
 * (chapters by subject, topics by chapter), an inline add strip (OPEN vocabularies), a "Seed canonical"
 * action, and a framed entry table with designed loading / empty / error states. Closed vocabularies
 * (question types, difficulty) show no add/delete — only name/alias edits on their seeded rows.
 */
export function DictionaryPanel({
  dimension,
  meta,
}: {
  dimension: TaxonomyDimension;
  meta: DimensionMeta;
}): JSX.Element {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const [search, setSearch] = useState('');
  const [scopeName, setScopeName] = useState('');
  const [newName, setNewName] = useState('');

  // Parent dictionary for the scope filter + create picker (only fetched for scoped dimensions).
  const parentDimension: TaxonomyDimension = meta.scope ?? 'subject';
  const parent = useDictionary(parentDimension, {}, meta.scope !== undefined);
  const parentEntries = parent.data?.entries ?? [];
  const parentNames = useMemo(() => parentEntries.map((entry) => entry.name), [parentEntries]);
  const nameToId = useMemo(
    () => new Map(parentEntries.map((entry) => [entry.name, entry.id])),
    [parentEntries],
  );
  const idToName = useMemo(
    () => new Map(parentEntries.map((entry) => [entry.id, entry.name])),
    [parentEntries],
  );
  const scopeId = nameToId.get(scopeName) ?? '';
  // Subjects are never nested under Exams. Instead, they may optionally carry any number of compatible
  // exam links; loading the small Exam dictionary here lets the Subject editor manage those links.
  const exams = useDictionary('exam', {}, dimension === 'subject');
  const examOptions = useMemo(
    () => (exams.data?.entries ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
    [exams.data],
  );

  const query: DictionaryQuery = {
    q: search.trim() || undefined,
    subjectId: meta.scope === 'subject' ? scopeId || undefined : undefined,
    chapterId: meta.scope === 'chapter' ? scopeId || undefined : undefined,
    moduleId: meta.scope === 'module' ? scopeId || undefined : undefined,
  };
  const list = useDictionary(dimension, query);
  const entries = list.data?.entries ?? [];

  const create = useCreateEntry(dimension);
  const update = useUpdateEntry(dimension);
  const remove = useDeleteEntry(dimension);
  const seed = useSeedDimension(dimension);

  const scopedButUnset = meta.scope !== undefined && !scopeId;
  const scopeLabel = meta.scope ?? '';
  const filtered = Boolean(search.trim() || scopeId);

  const onAdd = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    const body: CreateDictionaryEntry = { name };
    if (meta.scope === 'subject') body.subjectId = scopeId;
    if (meta.scope === 'chapter') body.chapterId = scopeId;
    if (meta.scope === 'module') body.moduleId = scopeId;
    try {
      await create.mutateAsync(body);
      toast.success(`Added ${meta.singular}`, name);
      setNewName('');
    } catch (error) {
      toast.error(`Could not add ${meta.singular}`, errorMessage(error));
    }
  };

  const onSaveRow =
    (id: string) =>
    async (body: UpdateDictionaryEntry): Promise<void> => {
      try {
        await update.mutateAsync({ id, body });
        toast.success('Saved');
      } catch (error) {
        toast.error('Could not save', errorMessage(error));
      }
    };

  const onDeleteRow = (id: string, name: string) => async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Delete ${meta.singular}?`,
      body: `"${name}" will be removed from the ${meta.singular} dictionary. This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(id);
      toast.success(`Deleted ${meta.singular}`, name);
    } catch (error) {
      toast.error(`Could not delete ${meta.singular}`, errorMessage(error));
    }
  };

  const onSeed = async (): Promise<void> => {
    try {
      const result = await seed.mutateAsync();
      toast.success('Seeded canonical values', `${String(result.created)} added`);
    } catch (error) {
      toast.error('Could not seed', errorMessage(error));
    }
  };

  const countLabel = list.data
    ? `${String(entries.length)} ${entries.length === 1 ? meta.singular : meta.label.toLowerCase()}`
    : '';

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="max-w-xl text-sm text-ink-2">{meta.description}</p>
        <div className="flex items-center gap-3">
          {countLabel ? (
            <span className="text-xs text-ink-3 tabular-nums">{countLabel}</span>
          ) : null}
          {meta.seedable ? (
            <Button
              variant="default"
              size="xs"
              onClick={() => void onSeed()}
              disabled={seed.isPending}
            >
              {seed.isPending ? 'Seeding…' : 'Seed canonical'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <IconSearch
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            type="text"
            className="w-full !pl-9"
            placeholder={`Search ${meta.label.toLowerCase()}…`}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            aria-label={`Search ${meta.label.toLowerCase()}`}
          />
        </div>
        {meta.scope ? (
          <div className="flex min-w-[240px] items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <Combobox
                options={parentNames}
                value={scopeName}
                onChange={setScopeName}
                allowCustom={false}
                placeholder={`All ${scopeLabel}s`}
              />
            </div>
            {scopeName ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setScopeName('');
                }}
                aria-label="Clear filter"
              >
                <IconX />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {meta.creatable ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAdd();
          }}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2/30 px-2.5 py-2"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <IconPlus className="size-4" />
          </span>
          <input
            type="text"
            className="min-w-[200px] flex-1"
            placeholder={`Add ${/^[aeiou]/i.test(meta.singular) ? 'an' : 'a'} ${meta.singular}…`}
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
            aria-label={`New ${meta.singular} name`}
          />
          {meta.scope ? (
            scopeId ? (
              <Badge tone="info" dot={false}>
                under {scopeName}
              </Badge>
            ) : (
              <span className="text-xs text-ink-3">pick a {scopeLabel} to file under</span>
            )
          ) : null}
          <Button
            variant="primary"
            size="xs"
            type="submit"
            disabled={!newName.trim() || create.isPending || scopedButUnset}
          >
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      ) : null}

      {list.isError ? (
        <p className="error">{`Could not load ${meta.label.toLowerCase()}. ${errorMessage(list.error)}`}</p>
      ) : !list.data && list.isLoading ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <TableHeader />
          <ul className="divide-y divide-line">
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row} className="flex items-center gap-3 px-3 py-3">
                <div className={DICT_COL.name}>
                  <Skeleton className="h-4 w-40" />
                </div>
                <div className={DICT_COL.aliases}>
                  <Skeleton className="h-4 w-24" />
                </div>
                <div className={DICT_COL.used}>
                  <Skeleton className="ml-auto h-4 w-8" />
                </div>
                <div className={DICT_COL.actions} />
              </li>
            ))}
          </ul>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<IconLayers />}
          title={
            filtered ? `No ${meta.label.toLowerCase()} match` : `No ${meta.label.toLowerCase()} yet`
          }
          body={
            filtered
              ? 'Try a different search or clear the filter.'
              : meta.seedable
                ? `Seed the canonical ${meta.label.toLowerCase()}, or add your own above.`
                : `Add the first ${meta.singular} above to start filing questions under it.`
          }
          action={
            meta.seedable && !filtered ? (
              <Button variant="primary" onClick={() => void onSeed()} disabled={seed.isPending}>
                Seed canonical
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <TableHeader />
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <DictionaryRow
                key={entry.id}
                entry={entry}
                deletable={meta.creatable}
                scopeName={
                  meta.scope === 'subject'
                    ? (idToName.get(entry.subjectId ?? '') ?? null)
                    : meta.scope === 'chapter'
                      ? (idToName.get(entry.chapterId ?? '') ?? null)
                      : meta.scope === 'module'
                        ? (idToName.get(entry.moduleId ?? '') ?? null)
                        : null
                }
                parentScope={
                  meta.scope
                    ? {
                        field:
                          meta.scope === 'subject'
                            ? 'subjectId'
                            : meta.scope === 'chapter'
                              ? 'chapterId'
                              : 'moduleId',
                        label: meta.scope,
                        options: parentEntries.map((parentEntry) => ({
                          id: parentEntry.id,
                          name: parentEntry.name,
                        })),
                        valueId:
                          meta.scope === 'subject'
                            ? entry.subjectId
                            : meta.scope === 'chapter'
                              ? entry.chapterId
                              : entry.moduleId,
                        allowUnassigned: meta.scope !== 'module',
                      }
                    : undefined
                }
                examLinks={dimension === 'subject' ? { options: examOptions } : undefined}
                saving={update.isPending}
                onSave={onSaveRow(entry.id)}
                onDelete={() => void onDeleteRow(entry.id, entry.name)()}
              />
            ))}
          </ul>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

/** The dictionary table's column headings, aligned to {@link DICT_COL} widths. */
function TableHeader(): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface-2/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
      <span className={DICT_COL.name}>Name</span>
      <span className={DICT_COL.aliases}>Also known as</span>
      <span className={`${DICT_COL.used} text-right`}>Used</span>
      <span className={DICT_COL.actions} aria-hidden />
    </div>
  );
}
