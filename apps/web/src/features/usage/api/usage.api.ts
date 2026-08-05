import type {
  SessionUsageDetail,
  SessionUsageList,
  TokenLimit,
  UpdateTokenLimit,
  UsageAnalytics,
} from '@ingest/contracts';
import {
  SessionUsageDetailSchema,
  SessionUsageListSchema,
  TokenLimitSchema,
  UsageAnalyticsSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped calls to the usage endpoints. The only place this feature hits the network. */
export const usageApi = {
  analytics: (days: number): Promise<UsageAnalytics> => {
    return request(`/usage/analytics?days=${String(days)}`, { schema: UsageAnalyticsSchema });
  },

  sessions: (): Promise<SessionUsageList> => {
    return request('/usage/sessions', { schema: SessionUsageListSchema });
  },

  sessionDetail: (id: string): Promise<SessionUsageDetail> => {
    return request(`/usage/sessions/${id}`, { schema: SessionUsageDetailSchema });
  },

  getLimit: (): Promise<TokenLimit> => {
    return request('/usage/limit', { schema: TokenLimitSchema });
  },

  setLimit: (body: UpdateTokenLimit): Promise<TokenLimit> => {
    return request('/usage/limit', { method: 'PUT', body, schema: TokenLimitSchema });
  },
};
