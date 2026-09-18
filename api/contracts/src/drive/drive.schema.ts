import { z } from 'zod';

/** A PDF stored in Drive — the shape returned when a chapter's assembled PDF is uploaded. */
export const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
});
export type DriveFile = z.infer<typeof DriveFileSchema>;

/**
 * A folder in Drive — the storage destination a chapter's PDF is filed into. Drive is no longer a
 * vocabulary source; folders are created on demand, named after the chosen master value (Physics → the
 * "Physics" folder), so the destination path mirrors the operator's all-masters selection.
 */
export const DriveFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
});
export type DriveFolder = z.infer<typeof DriveFolderSchema>;
