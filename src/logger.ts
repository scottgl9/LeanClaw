import pino from 'pino';

const isJsonFormat = process.env.LOG_FORMAT === 'json';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(isJsonFormat
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
