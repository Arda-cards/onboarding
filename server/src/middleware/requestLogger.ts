import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from '../config.js';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

export const requestLogger = pinoHttp({
  logger,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  autoLogging: {
    ignorePaths: ['/health', '/ready'],
  },
});

export type RequestLogger = typeof requestLogger;
export const appLogger = logger;
