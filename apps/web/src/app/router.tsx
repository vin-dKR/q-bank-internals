import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/app-layout.js';
import { PipelinePage } from './pages/pipeline-page.js';
import { IngestPage } from './pages/ingest-page.js';
import { SessionsPage } from './pages/sessions-page.js';
import { SessionDetailPage } from './pages/session-detail-page.js';
import { MastersPage } from './pages/masters-page.js';
import { UsagePage } from './pages/usage-page.js';
import { BankPage } from './pages/bank-page.js';

/** The route map. Feature pages are composed here; features themselves stay routing-agnostic. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <IngestPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'sessions/:sessionId', element: <SessionDetailPage /> },
      { path: 'verify', element: <PipelinePage /> },
      { path: 'bank', element: <BankPage /> },
      { path: 'masters', element: <MastersPage /> },
      { path: 'usage', element: <UsagePage /> },
    ],
  },
]);
