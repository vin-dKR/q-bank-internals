import { type JSX, useState } from 'react';
import type { SessionUsage, TokenUsageWindow } from '@ingest/contracts';
import { useSessionUsage, useSessionUsageDetail } from '../hooks/use-usage.js';
import { formatTokens } from '../lib/format-tokens.js';
import { promptSharePct, tokensPerCall, tokensPerQuestion } from '../lib/metrics.js';

/** The per-document drill-down shown when a session row is expanded. Loads lazily on expand. */
function SessionDetail({ sessionId, colSpan }: { sessionId: string; colSpan: number }): JSX.Element {
  const detail = useSessionUsageDetail(sessionId);

  return (
    <tr className="usage-row__detail">
      <td colSpan={colSpan}>
        {detail.isPending ? (
          <p className="muted">Loading documents…</p>
        ) : detail.isError ? (
          <p className="error">Could not load session detail.</p>
        ) : detail.data.documents.length === 0 ? (
          <p className="muted">No document-level usage recorded for this session.</p>
        ) : (
          <table className="doc-table doc-table--nested">
            <thead>
              <tr>
                <th>Document</th>
                <th>Tokens</th>
                <th>Calls</th>
                <th>Tokens/call</th>
                <th>Prompt/Completion</th>
                <th>Questions</th>
                <th>Tokens/question</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.documents.map((doc) => (
                <tr key={doc.documentId}>
                  <td>{doc.fileName}</td>
                  <td className="num">{formatTokens(doc.totalTokens)}</td>
                  <td className="num">{formatTokens(doc.callCount)}</td>
                  <td className="num">{formatTokens(tokensPerCall(doc))}</td>
                  <td className="num">
                    {formatTokens(doc.promptTokens)} / {formatTokens(doc.completionTokens)}
                  </td>
                  <td className="num">{formatTokens(doc.questionCount)}</td>
                  <td className="num">
                    {doc.questionCount === 0
                      ? '—'
                      : formatTokens(tokensPerQuestion(doc.totalTokens, doc.questionCount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

const COLUMNS = 7;

/** A session row: totals + derived model metrics, expandable to its per-document breakdown. */
function SessionRow({
  session,
  expanded,
  onToggle,
}: {
  session: SessionUsage;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <>
      <tr className="usage-row" onClick={onToggle}>
        <td>
          <span className={`usage-row__caret ${expanded ? 'usage-row__caret--open' : ''}`}>▸</span>
          {session.label}
        </td>
        <td className="num">{formatTokens(session.totalTokens)}</td>
        <td className="num">{formatTokens(session.callCount)}</td>
        <td className="num">{formatTokens(tokensPerCall(session))}</td>
        <td className="num">{promptSharePct(session)}% in</td>
        <td className="num">{formatTokens(session.documentCount)}</td>
        <td className="num">
          {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleDateString() : '—'}
        </td>
      </tr>
      {expanded ? <SessionDetail sessionId={session.sessionId} colSpan={COLUMNS} /> : null}
    </>
  );
}

/** The "which session ate how much" table. Rows sort biggest-first; click one to drill into documents. */
export function SessionUsageTable(): JSX.Element {
  const usage = useSessionUsage();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (usage.isPending) return <p className="muted">Loading session usage…</p>;
  if (usage.isError) return <p className="error">Could not load session usage.</p>;

  const { sessions, unattributed } = usage.data;
  const hasUnattributed = unattributed.totalTokens > 0;

  if (sessions.length === 0 && !hasUnattributed) {
    return <p className="muted">No token usage recorded yet. Run an extraction to see it here.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Tokens</th>
            <th>Calls</th>
            <th>Tokens/call</th>
            <th>Prompt share</th>
            <th>Docs</th>
            <th>Last used</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              expanded={expandedId === session.sessionId}
              onToggle={() => {
                setExpandedId(expandedId === session.sessionId ? null : session.sessionId);
              }}
            />
          ))}
          {hasUnattributed ? <UnattributedRow totals={unattributed} /> : null}
        </tbody>
      </table>
    </div>
  );
}

/** The catch-all row for spend tied to no session (one-off LaTeX refinement). */
function UnattributedRow({ totals }: { totals: TokenUsageWindow }): JSX.Element {
  return (
    <tr className="usage-row usage-row--muted">
      <td>Unattributed (LaTeX refine)</td>
      <td className="num">{formatTokens(totals.totalTokens)}</td>
      <td className="num">{formatTokens(totals.callCount)}</td>
      <td className="num">{formatTokens(tokensPerCall(totals))}</td>
      <td className="num">{promptSharePct(totals)}% in</td>
      <td className="num">—</td>
      <td className="num">—</td>
    </tr>
  );
}
