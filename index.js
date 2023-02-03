#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const winston = require('winston');

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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

chokidar.watch([
  path.join(os.homedir(), 'FTP/media/*.jpg'),
  path.join(os.homedir(), 'FTP/media/*.mp4')],
  { persistent: true, ignoreInitial: true, awaitWriteFinish: true })
  .on('add', processMedia);

function processMedia(file) {
  if (path.extname(file) === '.jpg') {
    logger.info('post image: '+file);
    postToTwitter(file, 'image/jpg');
  } else if (path.extname(file) === '.mp4') {
    logger.info('post video: '+file);
    postToTwitter(file, 'video/mp4');
  }
}

// TWITTER
async function postToTwitter(file, type) {
  try {
    logger.info('init media upload to twitter');
    const init = await initUpload(fs.statSync(file).size, type); // Declare that you wish to upload some media
    logger.info(init);
    logger.info('append media to twitter');
    const append = await appendUpload(init.media_id_string, fs.readFileSync(file)) // Send the data for the media
    logger.info(append);
    logger.info('finalize media to twitter');
    const finalize = await finalizeUpload(init.media_id_string) // Declare that you are done uploading chunks
    logger.info(finalize);
    logger.info('post media to twitter');
    const post = await postMedia(init.media_id_string);
    logger.info(post);
    logger.info('done media post to twitter');
  } catch (e) {
    logger.info('media post to twitter had an error');
    logger.error(e);
    if (e.data && e.data.errors)
      logger.error(e.data.errors);
  }
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
