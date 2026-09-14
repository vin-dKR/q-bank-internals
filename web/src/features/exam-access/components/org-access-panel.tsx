import type { JSX } from 'react';
import type { ExamOption } from '@ingest/contracts';
import { Badge, EmptyState, LoadingState, useToast } from '../../../shared/ui/index.js';
import { useOrgExamAccess, useSetOrgExamAccess } from '../hooks/use-exam-access.js';
import { ExamAccessRow } from './exam-access-row.js';

/**
 * The Organizations tab: every real (coaching/school) tenant with its exam entitlement. Saving an
 * empty set clears the override so the org — and everyone in it without their own override — reverts
 * to the default. This is the coarse, institute-wide control; the Users tab is the per-person override.
 */
export function OrgAccessPanel({
  options,
  defaultLabels,
}: {
  options: readonly ExamOption[];
  defaultLabels: string;
}): JSX.Element {
  const orgs = useOrgExamAccess();
  const setOrg = useSetOrgExamAccess();
  const toast = useToast();

  if (orgs.isLoading) return <LoadingState label="Loading organizations…" />;
  if (orgs.isError) {
    return <p className="error">Couldn’t load organizations: {orgs.error.message}</p>;
  }

  const rows = orgs.data?.organizations ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No coaching or school organizations yet"
        body="Real tenants appear here once someone finishes onboarding as a coaching or school. Personal workspaces are never listed."
      />
    );
  }

  const customCount = rows.filter((org) => org.allowedExams.length > 0).length;

  return (
    <div className="flex flex-col">
      <p className="muted pb-1">
        {rows.length} organization{rows.length === 1 ? '' : 's'}
        {customCount > 0 ? ` · ${String(customCount)} with a custom set` : ' · all on the default'}
      </p>
      {rows.map((org) => (
        <ExamAccessRow
          // Remount after each save so the row restarts (collapsed) from the persisted value.
          key={`${org.id}:${org.allowedExams.join(',')}`}
          name={org.name}
          subtitle={`${String(org.memberCount)} member${org.memberCount === 1 ? '' : 's'}`}
          tag={
            <Badge tone={org.type === 'coaching' ? 'info' : 'neutral'} dot={false}>
              {org.type}
            </Badge>
          }
          allowedExams={org.allowedExams}
          options={options}
          defaultLabels={defaultLabels}
          saving={setOrg.isPending && setOrg.variables.id === org.id}
          onSave={(allowedExams) => {
            setOrg.mutate(
              { id: org.id, body: { allowedExams } },
              {
                onSuccess: () => { toast.success('Saved', `Updated exam access for ${org.name}.`); },
                onError: (error) => { toast.error('Save failed', error.message); },
              },
            );
          }}
        />
      ))}
    </div>
  );
}
