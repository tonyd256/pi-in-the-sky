const { createClient } = require('redis');
const logger = require('./logger');

/* Redis */

const client = createClient();
client.on('error', err => logger.error('Redis Client Error: %s', err.message));

module.exports = {
  client
};
