import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './layout/app-layout.js';
import { RouteError } from './route-error.js';
import { PipelinePage } from './pages/pipeline-page.js';
import { TreeIngestPage } from './pages/tree-ingest-page.js';
import { SessionsPage } from './pages/sessions-page.js';
import { SessionDetailPage } from './pages/session-detail-page.js';
import { DocumentDataPage } from './pages/document-data-page.js';
import { TaxonomyPage } from './pages/taxonomy-page.js';
import { ExamAccessPage } from './pages/exam-access-page.js';
import { SyllabiPage } from './pages/syllabi-page.js';
import { PromptsPage } from './pages/prompts-page.js';
import { UsagePage } from './pages/usage-page.js';
import { QuestionsPage } from './pages/questions-page.js';
import { QualityPage } from './pages/quality-page.js';
import { ChapterSplitterPage } from './pages/chapter-splitter-page.js';
import { PdfCutterPage } from './pages/pdf-cutter-page.js';
import { QnaPdfPage } from './pages/qna-pdf-page.js';
import { ImageRenamerPage } from './pages/image-renamer-page.js';
import { PdfEditorPage } from './pages/pdf-editor-page.js';

// The one app-wide fallback for anything a page throws. On a child route it replaces only the
// `<Outlet />` content, so the shell (sidebar) stays; on the root it also covers a layout-level throw.
const errorElement = <RouteError />;

/** The route map. Feature pages are composed here; features themselves stay routing-agnostic. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement,
    children: [
      { index: true, element: <TreeIngestPage />, errorElement },
      // v1 "Cut & upload" was removed; v2 is now the default. Keep /tree as a redirect for old links.
      { path: 'tree', element: <Navigate to="/" replace />, errorElement },
      { path: 'sessions', element: <SessionsPage />, errorElement },
      { path: 'sessions/:sessionId', element: <SessionDetailPage />, errorElement },
      { path: 'documents/:documentId/data', element: <DocumentDataPage />, errorElement },
      { path: 'verify', element: <PipelinePage />, errorElement },
      // "Fix bank images" folded into Verify — search a published question there. Keep the old link.
      { path: 'bank', element: <Navigate to="/verify" replace />, errorElement },
      { path: 'questions', element: <QuestionsPage />, errorElement },
      { path: 'quality', element: <QualityPage />, errorElement },
      { path: 'syllabi', element: <SyllabiPage />, errorElement },
      // Masters split into three pages; keep /masters as a redirect to the first for old links.
      { path: 'masters', element: <Navigate to="/masters/taxonomy" replace />, errorElement },
      { path: 'masters/taxonomy', element: <TaxonomyPage />, errorElement },
      { path: 'masters/exam-access', element: <ExamAccessPage />, errorElement },
      { path: 'prompts', element: <PromptsPage />, errorElement },
      { path: 'usage', element: <UsagePage />, errorElement },
      { path: 'tools/chapters', element: <ChapterSplitterPage />, errorElement },
      { path: 'tools/cut', element: <PdfCutterPage />, errorElement },
      { path: 'tools/qna', element: <QnaPdfPage />, errorElement },
      { path: 'tools/rename', element: <ImageRenamerPage />, errorElement },
      { path: 'tools/edit', element: <PdfEditorPage />, errorElement },
    ],
  },
]);
