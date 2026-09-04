import { type JSX, type ReactNode, useMemo } from 'react';
import type { Document } from '@ingest/contracts';
import { IconChevronDown, StatusBadge } from '../../../shared/ui/index.js';
import { type DocumentUnit, groupByUnit } from '../lib/group-by-unit.js';

type DocumentUnitListProps = {
  items: Document[];
  /** Per-document action buttons, decided by the page (Run / View / Configs / Publish / delete). */
  renderActions: (doc: Document) => ReactNode;
};

/**
 * Documents grouped into units: one collapsible row per uploaded `(module · chapter · section)`. The
 * question part carries the unit's real status and count; answer/solution appear as quiet bound-context
 * rows — never with an extraction status or a "0 questions" that reads as failed.
 */
export function DocumentUnitList({ items, renderActions }: DocumentUnitListProps): JSX.Element {
  const units = useMemo(() => groupByUnit(items), [items]);
  return (
    <div className="unit-list">
      {units.map((unit) => (
        <UnitRow key={unit.key} unit={unit} renderActions={renderActions} />
      ))}
    </div>
  );
}

function UnitRow({
  unit,
  renderActions,
}: {
  unit: DocumentUnit;
  renderActions: (doc: Document) => ReactNode;
}): JSX.Element {
  const primary = unit.questions[0];
  const totalQuestions = unit.questions.reduce((sum, doc) => sum + doc.questionCount, 0);
  const supportingKinds = new Set(unit.supporting.map((doc) => doc.kind));

  return (
    <details className="unit" open>
      <summary className="unit__summary">
        <IconChevronDown className="unit__caret" />
        <div className="unit__summary-main">
          <span className="unit__title">{unit.title || 'Untitled unit'}</span>
          <span className="unit__sub">{unit.module}</span>
        </div>
        <div className="unit__chips">
          {unit.questions.length > 0 ? <span className="chip is-question">Question</span> : null}
          {supportingKinds.has('answer') ? <span className="chip is-answer">Answer</span> : null}
          {supportingKinds.has('solution') ? <span className="chip is-solution">Solution</span> : null}
        </div>
        {primary ? (
          <StatusBadge status={primary.status} />
        ) : (
          <span className="badge badge--neutral">uploaded</span>
        )}
        <span className="unit__count">{totalQuestions} Q</span>
      </summary>

      <div className="unit__body">
        {unit.questions.length > 0 ? (
          <div className="table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Question PDF</th><th>Status</th><th>Questions</th><th></th></tr>
              </thead>
              <tbody>
                {unit.questions.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.fileName}</td>
                    <td><StatusBadge status={doc.status} /></td>
                    <td>{doc.questionCount}</td>
                    <td className="cell-actions">
                      <div className="row row--end">
                        {renderActions(doc)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {unit.supporting.length > 0 ? (
          <div className="unit__supporting">
            <p className="unit-note">Bound to the question extraction — read as context, not extracted on their own.</p>
            {unit.supporting.map((doc) => (
              <div key={doc.id} className="unit-part">
                <span className={`chip is-${doc.kind}`}>{doc.kind}</span>
                <span className="unit-part__name" title={doc.fileName}>{doc.fileName}</span>
                <div className="unit-part__actions">{renderActions(doc)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
