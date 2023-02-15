#!/usr/bin/env node
require('dotenv').config();

const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const chokidar = require('chokidar');
const sharp = require("sharp");
sharp.cache(false);
const dns = require('dns');
const _ = require('lodash');
const twitter = require('./twitter');
const logger = require('./logger');
const { client } = require('./db');
const gps = require('./gps');

/* Helpers */

async function isConnected() {
  return new Promise(function (resolve, reject) {
    dns.lookup('google.com', function (err, address, family) {
      if (err) reject(err);
      resolve(address);
    });
  });
}

async function processMedia(file, stat) {
  try {
    // only resize if more than half a meg
    if (stat.size > 500000) {
      logger.info('resizing image: ' + file);
      const buff = await sharp(file)
        .resize(1080, 1080, {
          fit: 'outside',
          withoutEnlargement: true
        })
        .toFormat("jpeg", { mozjpeg: true })
        .toBuffer();
      await sharp(buff).toFile(file);
    }

    const fileTime = await client.hGet('files', file);

    if (!fileTime) {
      logger.info('save image to db');
      await client.hSet("files", file, stat.ctime.getTime());

      await client.hGetAll("gps");
    }
  } catch (e) {
    logger.error("There was an error in processing");
    logger.error(e.message);
  }
}

async function postIfCan() {
  try {
    const files = await client.hGetAll("files");

    if (_.keys(files).length > 0) {
      logger.info('check if connected');
      await isConnected();

      if (!_.isEmpty(files)) {
        const file = _.head(_.sortBy(_.toPairs(files), function (o) { return o[1]; }));

        if (file) {
          await twitter.postToTwitter(file[0]);
          await deleteFile(file[0]);
        }
      }
    }

    if (_.keys(files).length > 1) {
      await postIfCan();
    }
  } catch (e) {
    logger.error("There was an error in posting");
    logger.error(e.message);
  }

  setTimeout(postIfCan, 5000);
}

async function deleteFile(file) {
  await fs.unlink(file);
  await client.hDel("files", file);
}

async function run() {
  await client.connect();

  chokidar.watch([
    path.join(os.homedir(), 'FTP/media/*.jpg')],
    // path.join(os.homedir(), 'FTP/media#<{(|.mp4')],
    { persistent: true, ignoreInitial: false, awaitWriteFinish: true, alwaysStat: true })
    .on('add', processMedia);

  setTimeout(postIfCan, 5000);

  gps.activate();
}

run();
