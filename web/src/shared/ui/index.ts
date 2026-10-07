// Cross-cutting UI primitives shared by every feature (§ feature-slicing: shared/ui).
export { Button, buttonClasses } from './button.js';
export { Card } from './card.js';
export { Badge, type BadgeTone } from './badge.js';
export { StatusBadge } from './status-badge.js';
export { PageHeader } from './page-header.js';
export { CropCanvas, ZoomControls, type CanvasBox, type CanvasSize } from './crop-canvas.js';
export { DraggableBox, type BoxRect } from './draggable-box.js';
export { IconButton } from './icon-button.js';
export { InfoButton } from './info-button.js';
export { Toolbar, ToolbarGroup, ToolbarDivider, ToolbarSpacer, ToolbarHelp } from './toolbar.js';
export { useConfirm } from './confirm-dialog.js';
export { Combobox, type ComboboxOption } from './combobox.js';
export { ToastProvider, useToast } from './toast.js';
export { Spinner, LoadingState, Skeleton } from './spinner.js';
export { EmptyState } from './empty-state.js';
export {
  QuestionView,
  PassageView,
  type QuestionViewModel,
  type QuestionViewOption,
  type QuestionViewMatch,
  type QuestionViewMatchColumn,
  type QuestionViewMatchEntry,
  type PassageViewModel,
  MatchTableView,
} from './question-view.js';
export { CropImageButton } from './crop-image-button.js';
export { MatchTableEditor } from './match-table-editor.js';
export { FileDropzone } from './file-dropzone.js';
export { LoadedFileBar } from './loaded-file-bar.js';
export { ErrorFallback } from './error-fallback.js';
export { ErrorBoundary } from './error-boundary.js';
export {
  IconTrash,
  IconScissors,
  IconImage,
  IconDroplet,
  IconEdit,
  IconFlag,
  IconSparkle,
  IconUndo,
  IconRedo,
  IconPlus,
  IconX,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconCheck,
  IconWarning,
  IconSearch,
  IconZoomIn,
  IconZoomOut,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconHelp,
  IconInfo,
  IconRupee,
  IconLock,
  IconUnlock,
  IconLayers,
  IconScan,
  IconTextSelect,
  IconGrid,
  IconList,
  IconSigma,
  IconGripVertical,
} from './icons.js';
