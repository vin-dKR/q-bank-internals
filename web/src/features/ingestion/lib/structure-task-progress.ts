export type StructureTaskProgress = {
  completed: number;
  total: number;
  /** Crop work may finish before the final JSON is validated and delivered. */
  awaitingResult?: boolean;
};

/** Count processed crops; never show 100% while the last crop is still running. */
export function structureTaskPercent(progress: StructureTaskProgress): number {
  if (progress.total <= 0) return 0;
  const completed = Math.max(0, Math.min(progress.completed, progress.total));
  const percent = Math.floor((completed / progress.total) * 100);
  return progress.awaitingResult ? Math.min(percent, 99) : percent;
}
