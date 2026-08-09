// Cross-cutting UI primitives shared by every feature (§ feature-slicing: shared/ui).
export { Button, buttonClasses } from './button.js';
export { Card } from './card.js';
export { Badge, type BadgeTone } from './badge.js';
export { StatusBadge } from './status-badge.js';
export { PageHeader } from './page-header.js';
export { CropCanvas, type CanvasBox, type CanvasSize } from './crop-canvas.js';
export { DraggableBox, type BoxRect } from './draggable-box.js';
export { IconButton } from './icon-button.js';
export { Toolbar, ToolbarGroup, ToolbarDivider, ToolbarSpacer, ToolbarHelp } from './toolbar.js';
export { useConfirm } from './confirm-dialog.js';
export { Combobox } from './combobox.js';
export { ToastProvider, useToast } from './toast.js';
export { Spinner, LoadingState, Skeleton } from './spinner.js';
export { EmptyState } from './empty-state.js';
export { ErrorFallback } from './error-fallback.js';
export { ErrorBoundary } from './error-boundary.js';
export {
  IconTrash,
  IconSparkle,
  IconUndo,
  IconRedo,
  IconPlus,
  IconX,
  IconCheck,
  IconWarning,
  IconZoomIn,
  IconZoomOut,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconHelp,
  IconLayers,
  IconScan,
  IconGrid,
  IconList,
} from './icons.js';
