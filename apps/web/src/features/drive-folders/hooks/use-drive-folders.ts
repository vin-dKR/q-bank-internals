import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type { CreateFolder, DriveFolder, DriveFolderList } from '@ingest/contracts';
import { driveFoldersApi } from '../api/drive-folders.api.js';

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
