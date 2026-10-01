import { pino, type LoggerOptions } from 'pino';
import { env, isServerless } from '../../config/index.js';

/**
 * The one logger for the backend (§6.4). Routine request, startup, and debug output is deliberately
 * silent: the operator console is reserved for backend errors that need attention.
 */
const options: LoggerOptions = {
  level: 'error',
};
// pino-pretty loads in a worker thread via a dynamic specifier, which serverless bundlers cannot
// trace — spawning it on Vercel crashes the function at boot. Plain JSON logs there, always.
if (env.NODE_ENV === 'development' && !isServerless) {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);

export type Logger = typeof logger;
