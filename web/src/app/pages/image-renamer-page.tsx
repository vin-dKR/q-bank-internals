import type { JSX } from 'react';
import { ImageRenamerTool } from '../../features/image-renamer/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Image Renamer tool page: batch-rename images to `base-NNN.ext` and download them zipped. */
export function ImageRenamerPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Image Renamer"
        subtitle="Batch-rename images to a numbered base name and download them as a zip."
      />
      <ImageRenamerTool />
    </section>
  );
}
