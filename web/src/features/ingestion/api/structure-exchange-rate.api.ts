import { z } from 'zod';
import { request } from '../../../shared/api/http-client.js';

export const UsdInrRateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.literal('USD'),
  quote: z.literal('INR'),
  rate: z.number().finite().positive(),
});
export type UsdInrRate = z.infer<typeof UsdInrRateSchema>;
export const USD_INR_RATE_URL = 'https://api.frankfurter.dev/v2/rate/usd/inr';

/** Only the currency pair is sent; crop text, PDF data and model usage stay in the app. */
export function getStructureExchangeRate(): Promise<UsdInrRate> {
  return request(USD_INR_RATE_URL, { schema: UsdInrRateSchema, raw: true, timeoutMs: 10000 });
}
