import type { RequestHandler } from 'express';
import { CatalogFilterOptionsQuerySchema, CatalogQuerySchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import type { CatalogFilters, CatalogFilterSelection } from './catalog.repository.js';
import type { CatalogService } from './catalog.service.js';

export function createCatalogController(service: CatalogService): {
  list: RequestHandler;
  filterOptions: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const {
        exam, subject, module, chapter, section, questionType, flagged, pyq,
        hasImage, hasQuestionImage, hasOptionImage, hasPassageImage, hasPassage, hasMatch, aiFilled,
        q, sort, cursor, limit,
      } = parseOrThrow(CatalogQuerySchema, req.query);
      // Build with only the present keys — the repo runs `exactOptionalPropertyTypes`, so an
      // optional filter field must be absent, never explicitly `undefined`.
      const filters: CatalogFilters = {
        ...(exam !== undefined && { exam }),
        ...(subject !== undefined && { subject }),
        ...(module !== undefined && { module }),
        ...(chapter !== undefined && { chapter }),
        ...(section !== undefined && { section }),
        ...(questionType !== undefined && { questionType }),
        ...(flagged !== undefined && { flagged: flagged === 'true' }),
        ...(pyq !== undefined && { pyq: pyq === 'true' }),
        ...(hasImage !== undefined && { hasImage: hasImage === 'true' }),
        ...(hasQuestionImage !== undefined && { hasQuestionImage: hasQuestionImage === 'true' }),
        ...(hasOptionImage !== undefined && { hasOptionImage: hasOptionImage === 'true' }),
        ...(hasPassageImage !== undefined && { hasPassageImage: hasPassageImage === 'true' }),
        ...(hasPassage !== undefined && { hasPassage: hasPassage === 'true' }),
        ...(hasMatch !== undefined && { hasMatch: hasMatch === 'true' }),
        ...(aiFilled !== undefined && { aiFilled: aiFilled === 'true' }),
        ...(q !== undefined && { q }),
      };
      ok(res, await service.listQuestions(filters, sort, cursor ?? null, limit));
    }),

    filterOptions: asyncHandler(async (req, res) => {
      const { exam, subject, module, chapter, questionType } = parseOrThrow(
        CatalogFilterOptionsQuerySchema,
        req.query,
      );
      // Only the present keys — the repo runs `exactOptionalPropertyTypes` (no explicit `undefined`).
      const selection: CatalogFilterSelection = {
        ...(exam !== undefined && { exam }),
        ...(subject !== undefined && { subject }),
        ...(module !== undefined && { module }),
        ...(chapter !== undefined && { chapter }),
        ...(questionType !== undefined && { questionType }),
      };
      ok(res, await service.filterOptions(selection));
    }),
  };
}
