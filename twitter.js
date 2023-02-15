const fs = require('fs/promises');
const logger = require('./logger');
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

const at = require('./data/additionalText.json');

/* Twitter */

async function postToTwitter(file, title) {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Not production. Will not post to Twitter.');
    return;
  }

  logger.info('init media upload to twitter: ' + file);
  const info = await fs.stat(file);
  const data = await fs.readFile(file);

  const type = "image/jpeg";
  const init = await initUpload(info.size, type); // Declare that you wish to upload some media
  logger.info(init);

  logger.info('append media to twitter');

  const append = await appendUpload(init.media_id_string, data) // Send the data for the media
  logger.info(append);

  logger.info('finalize media to twitter');

  const finalize = await finalizeUpload(init.media_id_string) // Declare that you are done uploading chunks
  logger.info(finalize);

  logger.info('post media to twitter');

  const post = await postMedia(init.media_id_string, title + at.additionalText);
  logger.info(post);

  logger.info('done media post to twitter');
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

function postMedia(mediaId, status) {
  return makePost('statuses/update', {
    status,
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

module.exports = {
  postToTwitter
};
