import { z } from 'zod';
import { config } from '../../config/env.js';
import { request } from './http-client.js';

const PageCountSchema = z.object({ pages: z.number().int().nonnegative() });

/** Direct <img src> URL for a document's rendered source page (same-origin, proxied to the API). */
export function pageImageUrl(documentId: string, page: number): string {
  return `${config.apiBaseUrl}/pages/${documentId}/${String(page)}`;
}

/** How many pages a document's source PDF has (drives a page selector). */
export async function fetchPageCount(documentId: string): Promise<number> {
  const result = await request(`/pages/${documentId}/count`, { schema: PageCountSchema });
  return result.pages;
}
