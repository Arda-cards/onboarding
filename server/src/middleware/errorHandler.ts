import type { ErrorRequestHandler } from 'express';
import * as Sentry from '@sentry/node';
import { env } from '../config.js';
import { appLogger } from './requestLogger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? 'Internal server error' : err.message || 'Request failed';

  appLogger.error({ err, path: req.path, status }, 'Request failed');
  if (env.SENTRY_DSN) {
    Sentry.captureException(err);
  }

  res.status(status).json({ error: message });
};
