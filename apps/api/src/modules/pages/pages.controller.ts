import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { PagesService } from './pages.service.js';

const PageParamSchema = z.coerce.number().int().positive();

export function createPagesController(service: PagesService): {
  render: RequestHandler;
  count: RequestHandler;
} {
  return {
    render: asyncHandler(async (req, res) => {
      const documentId = requiredParam(req, 'documentId');
      const page = parseOrThrow(PageParamSchema, requiredParam(req, 'page'));
      const png = await service.renderPage(documentId, page);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(png);
    }),

    count: asyncHandler(async (req, res) => {
      ok(res, { pages: await service.pageCount(requiredParam(req, 'documentId')) });
    }),
  };
}
