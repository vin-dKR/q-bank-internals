import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

/** Any route that fell through the router is a 404 in the same envelope as every other error. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError('ROUTE_NOT_FOUND', 404, `No route for ${req.method} ${req.path}.`));
};
