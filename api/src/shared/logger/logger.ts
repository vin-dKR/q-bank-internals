import { pino, type LoggerOptions } from 'pino';
import { env } from '../../config/index.js';

/** The one logger for the whole backend (§6.4). `console` is banned by lint; use this. */
const options: LoggerOptions = {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
};
if (env.NODE_ENV === 'development') {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);

export type Logger = typeof logger;
