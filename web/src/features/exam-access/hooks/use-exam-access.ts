import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ExamOptions,
  OrgExamAccess,
  OrgExamAccessList,
  UpdateExamAccess,
  UserExamAccess,
  UserExamAccessList,
} from '@ingest/contracts';
import { examAccessApi } from '../api/exam-access.api.js';

/** The assignable exam catalog (live distinct exam_name from the bank) + default ids. */
export function useExamOptions(): UseQueryResult<ExamOptions> {
  return useQuery({
    queryKey: ['exam-access', 'exams'],
    queryFn: () => examAccessApi.exams(),
    // The catalog only grows when a new exam is tagged in the bank — refresh occasionally, not hard-forever.
    staleTime: 5 * 60 * 1000,
  });
}

/** All real (coaching/school) organizations with their current entitlement. */
export function useOrgExamAccess(): UseQueryResult<OrgExamAccessList> {
  return useQuery({
    queryKey: ['exam-access', 'organizations'],
    queryFn: () => examAccessApi.listOrganizations(),
  });
}

/** Save one org's allowed exams, then refresh the org list. */
export function useSetOrgExamAccess(): UseMutationResult<
  OrgExamAccess,
  Error,
  { id: string; body: UpdateExamAccess }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => examAccessApi.setOrganization(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-access', 'organizations'] });
    },
  });
}

/** A searched, capped page of users with their per-user override. */
export function useUserExamAccess(q: string, limit = 50): UseQueryResult<UserExamAccessList> {
  return useQuery({
    queryKey: ['exam-access', 'users', q, limit],
    queryFn: () => examAccessApi.listUsers(q, limit),
  });
}

/** Save one user's allowed exams, then refresh every user page (any search term). */
export function useSetUserExamAccess(): UseMutationResult<
  UserExamAccess,
  Error,
  { id: string; body: UpdateExamAccess }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => examAccessApi.setUser(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-access', 'users'] });
    },
  });
}
