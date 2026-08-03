// Public surface of the ingestion feature (§4). The page composes these; internals stay private.
export { PdfUploader } from './components/pdf-uploader.js';
export { PdfPreviewer } from './components/pdf-previewer.js';
export { PdfToolbar } from './components/pdf-toolbar.js';
export { ChapterGroupingPanel } from './components/chapter-grouping-panel.js';
export { DrivePathExplorer } from './components/drive-path-explorer.js';
export { useSplitPoints, type SplitPointsController } from './hooks/use-split-points.js';
export { useUploadChapter, type UploadChapterInput } from './hooks/use-upload-chapter.js';
export { buildChapterPdfs } from './lib/build-chapter-pdfs.js';
export { type ChapterGroup, emptyMetadata } from './types/chapter-group.js';
export type { SplitPointsByPage } from './types/split-point.js';
