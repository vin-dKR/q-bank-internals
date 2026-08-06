import type { CreateFolder, DriveFolder, DriveFolderList } from '@ingest/contracts';
import { CreateFolderSchema, DriveFolderListSchema, DriveFolderSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped calls to the Drive folder endpoints. The only place this feature hits the network. */
export const driveFoldersApi = {
  list: (parentId?: string): Promise<DriveFolderList> => {
    const query = parentId ? `?${new URLSearchParams({ parentId }).toString()}` : '';
    return request(`/drive/folders${query}`, { schema: DriveFolderListSchema });
  },

  create: (body: CreateFolder): Promise<DriveFolder> => {
    return request('/drive/folders', {
      method: 'POST',
      body: CreateFolderSchema.parse(body),
      schema: DriveFolderSchema,
    });
  },
};
