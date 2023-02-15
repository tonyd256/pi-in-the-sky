const winston = require('winston');

/* Logging */

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.prettyPrint(),
    winston.format.splat(),
    winston.format.simple(),
    winston.format.printf(context => {
      if (typeof context.message === 'object') {
        const msgstr = JSON.stringify(context.message, null, '\t');
        return `[${context.level}]${msgstr}`;
      }
      return context.message;
    })
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.prettyPrint(),
      winston.format.splat(),
      winston.format.simple(),
      winston.format.printf(context => {
        if (typeof context.message === 'object') {
          const msgstr = JSON.stringify(context.message, null, '\t');
          return `[${context.level}]${msgstr}`;
        }
        return context.message;
      })
    ),
  }));
}

module.exports = {
  info: logger.info.bind(logger),
  error: logger.error.bind(logger)
};
