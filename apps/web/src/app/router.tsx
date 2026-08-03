import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/app-layout.js';
import { PipelinePage } from './pages/pipeline-page.js';
import { IngestPage } from './pages/ingest-page.js';
import { SessionsPage } from './pages/sessions-page.js';

/** The route map. Feature pages are composed here; features themselves stay routing-agnostic. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <IngestPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'verify', element: <PipelinePage /> },
    ],
  },
]);
