import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/app-layout.js';
import { RouteError } from './route-error.js';
import { PipelinePage } from './pages/pipeline-page.js';
import { IngestPage } from './pages/ingest-page.js';
import { TreeIngestPage } from './pages/tree-ingest-page.js';
import { SessionsPage } from './pages/sessions-page.js';
import { SessionDetailPage } from './pages/session-detail-page.js';
import { MastersPage } from './pages/masters-page.js';
import { UsagePage } from './pages/usage-page.js';
import { BankPage } from './pages/bank-page.js';
import { QuestionsPage } from './pages/questions-page.js';

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
      { index: true, element: <IngestPage />, errorElement },
      { path: 'tree', element: <TreeIngestPage />, errorElement },
      { path: 'sessions', element: <SessionsPage />, errorElement },
      { path: 'sessions/:sessionId', element: <SessionDetailPage />, errorElement },
      { path: 'verify', element: <PipelinePage />, errorElement },
      { path: 'bank', element: <BankPage />, errorElement },
      { path: 'questions', element: <QuestionsPage />, errorElement },
      { path: 'masters', element: <MastersPage />, errorElement },
      { path: 'usage', element: <UsagePage />, errorElement },
    ],
  },
]);
