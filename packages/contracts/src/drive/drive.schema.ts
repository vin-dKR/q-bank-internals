import { z } from 'zod';

/** A PDF sitting in the Drive ingest folder — what the "select a PDF" dropdown is populated from. */
export const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
});
export type DriveFile = z.infer<typeof DriveFileSchema>;

/** A folder in Drive — the unit the chapter tree (exam → subject → module → chapter) is built from. */
export const DriveFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
});
export type DriveFolder = z.infer<typeof DriveFolderSchema>;

/** A list of folders (folder browse is not paginated for now). */
export const DriveFolderListSchema = z.array(DriveFolderSchema);
export type DriveFolderList = z.infer<typeof DriveFolderListSchema>;

/** Query for listing folders directly under a parent; omitted `parentId` means the configured root. */
export const ListFoldersQuerySchema = z.object({
  parentId: z.string().optional(),
});
export type ListFoldersQuery = z.infer<typeof ListFoldersQuerySchema>;

/** Body to create a folder under a parent (defaults to the configured root when `parentId` absent). */
export const CreateFolderSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
});
export type CreateFolder = z.infer<typeof CreateFolderSchema>;
