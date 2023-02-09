#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const winston = require('winston');
const sharp = require("sharp");
const dns = require('dns');
const { createClient } = require('redis');
const _ = require('lodash');

require('dotenv').config();

const { TwitterApi } = require('twitter-api-v2');
const Twitter = require('twitter');
const uploader = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});
const twitter = new TwitterApi({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

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

/* Helpers */

async function isConnected() {
  return new Promise(function (resolve, reject) {
    dns.lookup('google.com', function (err, address, family) {
      if (err) reject(err);
      resolve(address);
    });
  });
}

/* Redis */

const client = createClient();
client.on('error', err => logger.error('Redis Client Error %o', err));

chokidar.watch([
  path.join(os.homedir(), 'FTP/media/*.jpg')],
  // path.join(os.homedir(), 'FTP/media#<{(|.mp4')],
  { persistent: true, ignoreInitial: false, awaitWriteFinish: true, alwaysStat: true })
  .on('add', processMedia);

async function processMedia(file, stat) {
  // only resize if more than half a meg
  if (stat.size > 500000) {
    logger.info('resize image');
    await sharp(file)
      .resize(1080, 1080, {
        fit: 'outside',
        withoutEnlargement: true
      })
      .toFormat("jpeg", { mozjpeg: true })
      .toFile(file);
  }

  await client.connect();
  const file = client.hGet('files', file);

  if (!file) {
    await client.hSet("files", file, stat.ctime);
  }

  await client.disconnect();
  await postIfCan();
}

async function postIfCan() {
  var moreToPost = false;

  try {
    await isConnected();

    await client.connect();
    const files = await client.hGetAll("files");

    if (!_.isEmpty(files)) {
      const file = _.head(_.sortBy(_.toPairs(files), function (o) { return o[1]; }));

      if (file) {
        await postToTwitter(file[0]);
        await deleteFile(file[0]);
      }
    }

    await client.disconnect();

    if (_.keys(files) > 1) {
      moreToPost = true;
    }
  } catch (e) {
    logger.error(e);

    if (e.code && e.code === 'ENOTFOUND') {
      setTimeout(postIfCan, 5000);
    }
  }

  if (moreToPost) {
    postIfCan();
  }
}

async function deleteFile(file) {
  await fs.unlink(file);
  await client.hDel("files", file);
  logger.info('file deleted');
}

// TWITTER
async function postToTwitter(file) {
    // logger.info('init media upload to twitter');
    // const init = await initUpload(info.size, type); // Declare that you wish to upload some media
    // logger.info(init);
    // logger.info('append media to twitter');
    // const append = await appendUpload(init.media_id_string, data) // Send the data for the media
    // logger.info(append);
    // logger.info('finalize media to twitter');
    // const finalize = await finalizeUpload(init.media_id_string) // Declare that you are done uploading chunks
    // logger.info(finalize);
    // logger.info('post media to twitter');
    // const post = await postMedia(init.media_id_string);
    // logger.info(post);
    // logger.info('done media post to twitter');
}

/**
 * Step 1 of 3: Initialize a media upload
 * @return Promise resolving to String mediaId
 */
function initUpload (mediaSize, mediaType) {
  return makePost('media/upload', {
    command    : 'INIT',
    total_bytes: mediaSize,
    media_type : mediaType,
  });
}

/**
 * Step 2 of 3: Append file chunk
 * @param String mediaId    Reference to media object being uploaded
 * @return Promise resolving to String mediaId (for chaining)
 */
function appendUpload (mediaId, mediaData) {
  return makePost('media/upload', {
    command      : 'APPEND',
    media_id     : mediaId,
    media        : mediaData,
    segment_index: 0
  });
}

/**
 * Step 3 of 3: Finalize upload
 * @param String mediaId   Reference to media
 * @return Promise resolving to mediaId (for chaining)
 */
function finalizeUpload (mediaId) {
  return makePost('media/upload', {
    command : 'FINALIZE',
    media_id: mediaId
  });
}

function postMedia(mediaId) {
  return makePost('statuses/update', {
    status: 'test',
    media_ids: mediaId
  });
}

/**
 * (Utility function) Send a POST request to the Twitter API
 * @param String endpoint  e.g. 'statuses/upload'
 * @param Object params    Params object to send
 * @return Promise         Rejects if response is error
 */
function makePost (endpoint, params) {
  return new Promise((resolve, reject) => {
    uploader.post(endpoint, params, (error, data, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}
