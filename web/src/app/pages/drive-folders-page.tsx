import type { JSX } from 'react';
import { DrivePathExplorer } from '../../features/drive-folders/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Masters → Drive folders: browse or pre-create the exam → subject → module → chapter Drive tree. */
export function DriveFoldersPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Drive folders"
        subtitle="Browse or pre-create the Drive chapter tree — exam → subject → module → chapter — that uploads file into."
      />
      <section className="card">
        <DrivePathExplorer />
      </section>
    </section>
  );
}
