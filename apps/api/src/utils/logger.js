const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  customLevels: { http: 10 },
  useOnlyCustomLevels: false,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : { target: 'pino/file', options: { destination: './logs/app.log', mkdir: true } },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.token'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
