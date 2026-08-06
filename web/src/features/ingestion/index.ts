// Public surface of the ingestion feature (§4). The page composes these; internals stay private.
export { PdfUploader } from './components/pdf-uploader.js';
export { PdfPreviewer } from './components/pdf-previewer.js';
export { PdfToolbar } from './components/pdf-toolbar.js';
export { PdfModeSelector } from './components/pdf-mode-selector.js';
export { ReflowBlocksPanel } from './components/reflow-blocks-panel.js';
export { ChapterGroupingPanel } from './components/chapter-grouping-panel.js';
export { ChapterMetadataForm } from './components/chapter-metadata-form.js';
export { SeparateFilesPanel } from './components/separate-files-panel.js';
export { useSplitPoints, type SplitPointsController } from './hooks/use-split-points.js';
export { useWorkingDocument, type WorkingDocument } from './hooks/use-working-document.js';
export { useReflowBlocks, type ReflowController } from './hooks/use-reflow-blocks.js';
export { useUploadChapter, type UploadChapterInput } from './hooks/use-upload-chapter.js';
export { buildChapterPdfs, type PageKinds } from './lib/build-chapter-pdfs.js';
export { applyGridSplit } from './lib/apply-grid-split.js';
export { applyReflow } from './lib/apply-reflow.js';
export { deletePage } from './lib/delete-page.js';
export { aggregateSeparateChapters } from './lib/aggregate-separate.js';
export type { CutMode, ReadingOrder } from './types/cut-mode.js';
export { type ChapterGroup, emptyMetadata } from './types/chapter-group.js';
export {
  type SeparateFiles,
  type SeparateChapter,
  SEPARATE_FILE_SLOTS,
  emptySeparateFiles,
  emptySeparateChapter,
} from './types/separate-chapter.js';
export type { SplitPointsByPage } from './types/split-point.js';
