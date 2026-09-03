import type { PromptDefinition, PromptKey } from '@ingest/contracts';
import { PromptDefinitionSchema, PromptListSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped calls to the prompts endpoints. The only place this feature hits the network. */
export const promptsApi = {
  list: (): Promise<PromptDefinition[]> => request('/prompts', { schema: PromptListSchema }),

  update: (key: PromptKey, value: string): Promise<PromptDefinition> =>
    request(`/prompts/${key}`, { method: 'PUT', body: { value }, schema: PromptDefinitionSchema }),

  reset: (key: PromptKey): Promise<PromptDefinition> =>
    request(`/prompts/${key}`, { method: 'DELETE', schema: PromptDefinitionSchema }),
};
