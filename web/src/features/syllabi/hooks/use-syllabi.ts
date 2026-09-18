import { type UseMutationResult, type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Syllabus, SyllabusList, SyllabusFormats, SyllabusUpload, SyllabusUploadResult } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { syllabiApi } from '../api/syllabi.api.js';

const SYLLABI_KEY = ['syllabi'];

/** Every exam with a syllabus, with its subject/chapter/topic counts. */
export function useSyllabi(): UseQueryResult<SyllabusList> {
  return useQuery({ queryKey: SYLLABI_KEY, queryFn: () => syllabiApi.list() });
}

/** One exam's full tree, fetched only once its card is expanded. */
export function useSyllabus(exam: string, enabled: boolean): UseQueryResult<Syllabus> {
  return useQuery({ queryKey: [...SYLLABI_KEY, exam], queryFn: () => syllabiApi.detail(exam), enabled });
}

/** The upload formats and their samples — static server-side, so they are fetched once and kept. */
export function useSyllabusFormats(): UseQueryResult<SyllabusFormats> {
  return useQuery({ queryKey: [...SYLLABI_KEY, 'formats'], queryFn: () => syllabiApi.formats(), staleTime: Infinity });
}

function countsOf(result: SyllabusUploadResult): string {
  const topics = result.saved.reduce((total, syllabus) => total + syllabus.topics, 0);
  const exams = result.saved.map((syllabus) => syllabus.exam).join(', ');
  return `${exams} — ${String(topics)} topic${topics === 1 ? '' : 's'}.`;
}

/** Uploads a syllabus file; every exam it names is replaced whole. */
export function useUploadSyllabus(): UseMutationResult<SyllabusUploadResult, Error, SyllabusUpload> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (upload: SyllabusUpload) => syllabiApi.upload(upload),
    onSuccess: async (result) => {
      const replaced = result.replaced.length > 0 ? ` Replaced: ${result.replaced.join(', ')}.` : '';
      success('Syllabus saved', `${countsOf(result)}${replaced}`);
      await queryClient.invalidateQueries({ queryKey: SYLLABI_KEY });
    },
    onError: (err) => { error('Could not read that file', err.message); },
  });
}

/** Deletes an uploaded syllabus. The exam's bundled file, if it has one, applies again. */
export function useDeleteSyllabus(): UseMutationResult<SyllabusList, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (exam: string) => syllabiApi.remove(exam),
    onSuccess: async (list, exam) => {
      const fellBack = list.syllabi.some((syllabus) => syllabus.exam === exam);
      success(
        `Removed the uploaded ${exam} syllabus`,
        fellBack ? 'Its bundled file applies again.' : 'That exam now has no syllabus, so its topics cannot be matched.',
      );
      await queryClient.invalidateQueries({ queryKey: SYLLABI_KEY });
    },
    onError: (err) => { error('Could not remove that syllabus', err.message); },
  });
}
