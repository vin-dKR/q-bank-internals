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
      const preview = await service.previewPage(documentId, page);
      if ('url' in preview) {
        // Both the target object and this lookup are immutable for a completed source PDF.
        // Cache the redirect as well, so repeat Verify opens go straight to the CDN without
        // waking a serverless function to discover the same public object URL.
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        res.redirect(302, preview.url);
        return;
      }
      const { png } = preview;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(png);
    }),

    count: asyncHandler(async (req, res) => {
      ok(res, { pages: await service.pageCount(requiredParam(req, 'documentId')) });
    }),
  };
}
