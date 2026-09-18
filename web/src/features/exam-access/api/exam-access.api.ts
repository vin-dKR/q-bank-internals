import type {
  ExamOptions,
  OrgExamAccess,
  OrgExamAccessList,
  UpdateExamAccess,
  UserExamAccess,
  UserExamAccessList,
} from '@ingest/contracts';
import {
  ExamOptionsSchema,
  OrgExamAccessListSchema,
  OrgExamAccessSchema,
  UserExamAccessListSchema,
  UserExamAccessSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped calls to the exam-access endpoints. The only place this feature hits the network. */
export const examAccessApi = {
  exams: (): Promise<ExamOptions> => {
    return request('/exam-access/exams', { schema: ExamOptionsSchema });
  },

  listOrganizations: (): Promise<OrgExamAccessList> => {
    return request('/exam-access/organizations', { schema: OrgExamAccessListSchema });
  },

  setOrganization: (id: string, body: UpdateExamAccess): Promise<OrgExamAccess> => {
    return request(`/exam-access/organizations/${id}`, {
      method: 'PUT',
      body,
      schema: OrgExamAccessSchema,
    });
  },

  listUsers: (q: string, limit: number): Promise<UserExamAccessList> => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    return request(`/exam-access/users?${params.toString()}`, { schema: UserExamAccessListSchema });
  },

  setUser: (id: string, body: UpdateExamAccess): Promise<UserExamAccess> => {
    return request(`/exam-access/users/${id}`, { method: 'PUT', body, schema: UserExamAccessSchema });
  },
};
