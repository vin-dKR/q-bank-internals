import { type JSX, useState } from 'react';
import type { ExamOption } from '@ingest/contracts';
import { EmptyState, IconSearch, LoadingState, useToast } from '../../../shared/ui/index.js';
import { useSetUserExamAccess, useUserExamAccess } from '../hooks/use-exam-access.js';
import { ExamAccessRow } from './exam-access-row.js';

const PAGE_LIMIT = 50;

/**
 * The Users tab: a searched, capped list of individual accounts with their PER-USER override. An
 * empty set means "inherit" — the user follows their org (or the default). A non-empty set wins over
 * the org's, so this is the fine-grained escape hatch on top of the institute-wide Organizations tab.
 */
export function UserAccessPanel({
  options,
  defaultLabels,
}: {
  options: readonly ExamOption[];
  defaultLabels: string;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const users = useUserExamAccess(q, PAGE_LIMIT);
  const setUser = useSetUserExamAccess();
  const toast = useToast();

  const rows = users.data?.users ?? [];
  const customCount = rows.filter((user) => user.allowedExams.length > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          setQ(term.trim());
        }}
      >
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 [&>svg]:size-4">
          <IconSearch />
        </span>
        <input
          type="search"
          value={term}
          placeholder="Search users by name or email…"
          onChange={(event) => { setTerm(event.target.value); }}
          className="!pl-9"
        />
      </form>

      {users.isLoading ? (
        <LoadingState label="Loading users…" />
      ) : users.isError ? (
        <p className="error">Couldn’t load users: {users.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={q ? `No users match “${q}”` : 'No users yet'}
          body={q ? 'Try a different name or email.' : 'Users appear here once they sign in to the app.'}
        />
      ) : (
        <div className="flex flex-col">
          <p className="muted pb-1">
            {q ? `Results for “${q}”` : 'Most recent users'}
            {customCount > 0 ? ` · ${String(customCount)} with a custom set` : ''}
          </p>
          {rows.map((user) => (
            <ExamAccessRow
              key={`${user.id}:${user.allowedExams.join(',')}`}
              name={user.name ?? user.email}
              subtitle={
                user.orgNames.length > 0 ? `${user.email} · ${user.orgNames.join(', ')}` : user.email
              }
              allowedExams={user.allowedExams}
              options={options}
              defaultLabels={defaultLabels}
              saving={setUser.isPending && setUser.variables.id === user.id}
              onSave={(allowedExams) => {
                setUser.mutate(
                  { id: user.id, body: { allowedExams } },
                  {
                    onSuccess: () => {
                      toast.success('Saved', `Updated exam access for ${user.name ?? user.email}.`);
                    },
                    onError: (error) => { toast.error('Save failed', error.message); },
                  },
                );
              }}
            />
          ))}
          {users.data?.truncated ? (
            <p className="pt-3 text-xs text-ink-3">
              Showing the first {PAGE_LIMIT}. Narrow with a search to find a specific user.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
