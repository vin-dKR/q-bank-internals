import type { JSX } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { DocumentDataViewer } from '../../features/questions/index.js';

/**
 * "Question data" — the full extracted-data viewer for one document, opened from a document's Data
 * action. Renders every extracted question three ways (rendered / table / raw JSON). A missing id
 * (hand-typed URL) redirects home rather than rendering a broken viewer.
 */
export function DocumentDataPage(): JSX.Element {
  const { documentId } = useParams();
  if (!documentId) return <Navigate to="/sessions" replace />;
  return (
    <section className="page">
      <DocumentDataViewer documentId={documentId} />
    </section>
  );
}
