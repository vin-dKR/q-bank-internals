import type { JSX } from 'react';
import { DrivePathExplorer } from '../../features/drive-folders/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * "All masters" — the home for the reference data the pipeline files against. It's organised as a
 * set of self-contained modules; today there's the Drive folder tree (browse / pre-create the
 * exam → subject → module → chapter path), with more masters to be added here later.
 */
export function MastersPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="All masters"
        subtitle="Reference data the pipeline files against. Each card below is a self-contained master module."
      />

      <div className="masters-grid">
        <section className="card master-module">
          <div className="master-module__head">
            <h2 className="master-module__title">Drive folders</h2>
            <p className="muted">
              Browse or pre-create the Drive chapter tree — exam → subject → module → chapter — that
              uploads file into.
            </p>
          </div>
          <DrivePathExplorer />
        </section>
      </div>
    </section>
  );
}
