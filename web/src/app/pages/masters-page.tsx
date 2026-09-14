import type { JSX, ReactNode } from 'react';
import { DrivePathExplorer } from '../../features/drive-folders/index.js';
import { ExamAccessManager } from '../../features/exam-access/index.js';
import { IconFileText, IconLayers, PageHeader } from '../../shared/ui/index.js';

/** A titled, icon-headed card for one master module — the consistent frame every master sits in. */
function MasterModule({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="card">
      <div className="flex items-start gap-3 border-b border-line pb-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand [&>svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="card__title">{title}</h2>
          <p className="muted mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * "Masters" — the reference data the pipeline files against, one self-contained module per card.
 * Exam access (who sees which exams in the main bank) leads; the Drive folder tree follows. New
 * masters slot in as further {@link MasterModule} cards.
 */
export function MastersPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Masters"
        subtitle="Reference data the pipeline and the main app file against. Each card is a self-contained master."
      />

      <div className="masters-grid">
        <MasterModule
          icon={<IconLayers />}
          title="Exam access"
          description="Which exam families each coaching / school — or an individual user — sees in the main app’s question bank. Empty inherits the default (JEE, NEET, Boards)."
        >
          <ExamAccessManager />
        </MasterModule>

        <MasterModule
          icon={<IconFileText />}
          title="Drive folders"
          description="Browse or pre-create the Drive chapter tree — exam → subject → module → chapter — that uploads file into."
        >
          <DrivePathExplorer />
        </MasterModule>
      </div>
    </section>
  );
}
