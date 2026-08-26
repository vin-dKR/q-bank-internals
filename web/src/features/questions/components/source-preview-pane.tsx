import { type JSX, useEffect, useState } from 'react';
import { IconButton, IconChevronLeft, IconChevronRight } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';
import { usePageCount } from '../hooks/use-questions.js';

/**
 * A read-only preview of one sibling source PDF — the unit's answer or solution — shown beside the
 * question page in Verify. Owns its own page cursor: seeded to `defaultPage` (this topic's
 * answer/solution start) and re-seeded whenever that changes as the operator moves through the
 * question PDF, with prev/next nav so the answer/explanation can be checked against the question.
 */
export function SourcePreviewPane({
  title,
  tone,
  documentId,
  fileName,
  defaultPage,
}: {
  title: string;
  tone: 'answer' | 'solution';
  documentId: string;
  fileName: string;
  defaultPage: number;
}): JSX.Element {
  const [page, setPage] = useState(defaultPage);
  useEffect(() => { setPage(defaultPage); }, [defaultPage]);
  const pageCount = usePageCount(documentId);
  const totalPages = pageCount.data ?? 1;

  return (
    <div className="verify__source">
      <div className="verify__source-head">
        <span className={`chip ${tone === 'answer' ? 'is-answer' : 'is-solution'}`}>{title}</span>
        <span className="verify__source-name" title={fileName}>{fileName}</span>
        <div className="verify__source-nav">
          <IconButton
            icon={<IconChevronLeft />}
            label="Previous page"
            size="sm"
            disabled={page <= 1}
            onClick={() => { setPage((current) => Math.max(1, current - 1)); }}
          />
          <span className="verify__source-count">{page} / {totalPages}</span>
          <IconButton
            icon={<IconChevronRight />}
            label="Next page"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => { setPage((current) => Math.min(totalPages, current + 1)); }}
          />
        </div>
      </div>
      <div className="verify__source-scroll">
        <img
          src={questionsApi.pageImageUrl(documentId, page)}
          alt={`${title} page ${String(page)}`}
          className="verify__source-img"
        />
      </div>
    </div>
  );
}
