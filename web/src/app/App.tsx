import type { JSX } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './providers.js';
import { router } from './router.js';

/** Root component: providers wrap the router. Composition only — no logic. */
export function App(): JSX.Element {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
