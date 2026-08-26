import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type {
  CreateFolder,
  DeleteFolderResult,
  DriveFolder,
  DriveFolderList,
} from '@ingest/contracts';
import { driveFoldersApi } from '../api/drive-folders.api.js';

/** Arguments for a folder delete: the folder id and whether to force-delete a non-empty folder. */
export type DeleteFolderInput = { id: string; force?: boolean };

/** Loads the folders directly under `parentId` (or the configured root when omitted). */
export function useDriveFolders(parentId?: string): UseQueryResult<DriveFolderList> {
  return useQuery({
    queryKey: ['drive-folders', parentId ?? null],
    queryFn: () => driveFoldersApi.list(parentId),
  });
}

/** Creates a folder and refreshes the folder lists so the new folder appears immediately. */
export function useCreateFolder(): UseMutationResult<DriveFolder, Error, CreateFolder> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFolder) => driveFoldersApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drive-folders'] });
    },
  });
}

/** Deletes a folder and refreshes the folder lists so it disappears immediately. */
export function useDeleteFolder(): UseMutationResult<DeleteFolderResult, Error, DeleteFolderInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: DeleteFolderInput) => driveFoldersApi.remove(id, force),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drive-folders'] });
    },
  });
}
