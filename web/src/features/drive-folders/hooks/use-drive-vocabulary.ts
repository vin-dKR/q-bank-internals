import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { DriveFolderList } from '@ingest/contracts';
import { ApiError } from '../../../shared/api/http-client.js';
import { driveFoldersApi } from '../api/drive-folders.api.js';

/** The distinct folder names at each level of the masters chapter tree (exam → subject → module → chapter). */
export type DriveVocabulary = {
  exams: string[];
  subjects: string[];
  modules: string[];
  chapters: string[];
};

const EMPTY_VOCABULARY: DriveVocabulary = { exams: [], subjects: [], modules: [], chapters: [] };

async function listChildren(parents: DriveFolderList): Promise<DriveFolderList> {
  const lists = await Promise.all(parents.map((folder) => driveFoldersApi.list(folder.id)));
  return lists.flat();
}

function names(folders: DriveFolderList): string[] {
  return [...new Set(folders.map((folder) => folder.name))];
}

/** Walk the masters tree breadth-first from the configured root, one folder level per vocabulary level. */
async function fetchDriveVocabulary(): Promise<DriveVocabulary> {
  const exams = await driveFoldersApi.list();
  const subjects = await listChildren(exams);
  const modules = await listChildren(subjects);
  const chapters = await listChildren(modules);
  return {
    exams: names(exams),
    subjects: names(subjects),
    modules: names(modules),
    chapters: names(chapters),
  };
}

/**
 * Loads the names created in the All Masters Drive tree, per level, to seed metadata suggestions
 * (merged with document/session-derived values by the consumer). Suggestions are an enhancement,
 * never a gate: any API-reported failure — Drive unconfigured (`DRIVE_UNAVAILABLE`) or unreachable —
 * resolves to empty lists so the form still works on document-derived suggestions alone.
 */
export function useDriveVocabulary(): UseQueryResult<DriveVocabulary> {
  return useQuery({
    // Lives under the 'drive-folders' prefix so useCreateFolder's invalidation refreshes it too.
    queryKey: ['drive-folders', 'vocabulary'],
    queryFn: async (): Promise<DriveVocabulary> => {
      try {
        return await fetchDriveVocabulary();
      } catch (error) {
        if (error instanceof ApiError) return EMPTY_VOCABULARY;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}
