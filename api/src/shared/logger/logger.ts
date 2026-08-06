import { pino, type LoggerOptions } from 'pino';
import { env, isServerless } from '../../config/index.js';

/** The one logger for the whole backend (§6.4). `console` is banned by lint; use this. */
const options: LoggerOptions = {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
};
// pino-pretty loads in a worker thread via a dynamic specifier, which serverless bundlers cannot
// trace — spawning it on Vercel crashes the function at boot. Plain JSON logs there, always.
if (env.NODE_ENV === 'development' && !isServerless) {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);

export type Logger = typeof logger;
