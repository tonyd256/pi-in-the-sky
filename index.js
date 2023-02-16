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
      await client.hSet("files", file, parseInt(stat.ctime.getTime()));
      logger.info('saved: '+ file + ' at ' + stat.ctime.getTime());

      const gpsData = await gps.getGPS();
      if (!_.isEmpty(gpsData)) {
        await client.hSet("files", file + ".title", gpsData.title);
        logger.info('save gps: ' + gpsData.title);
      }
    }
  } catch (e) {
    logger.error("There was an error in processing");
    logger.error(e.message);
  }
}

async function postIfCan() {
  try {
    const files = await client.hGetAll("files");
    const keys = _.keys(files);
    const noTitles = _.filter(keys, function (f) { return !f.endsWith(".title"); });

    if (!_.isEmpty(keys)) {
      logger.info('check if connected');
      await isConnected();

      const file = _.head(_.sortBy(keys, function (o) { return parseInt(files[o]); }));

      if (file) {
        await twitter.postToTwitter(file, files[file+".title"] || "");
        await deleteFile(file);
      }
    }

    if (noTitles.length > 1) {
      logger.info('more to post');
      await postIfCan();
    }
  } catch (e) {
    logger.error("There was an error in posting");
    logger.error(e.message);
  }

  setTimeout(postIfCan, 10000);
}

async function deleteFile(file) {
  await fs.unlink(file);
  await client.hDel("files", file);
  await client.hDel("files", file+".title");
}

async function run() {
  try {
    await client.connect();
    const directories = [
      path.join(os.homedir(), 'FTP/media/*.jpg'),
      path.join(os.homedir(), 'FTP/media/*.JPG'),
      // path.join(os.homedir(), 'FTP/media#<{(|.mp4'),
    ];
    logger.info("watching: " + directories.join(", "));

    chokidar.watch(
      directories,
      { persistent: true, ignoreInitial: false, awaitWriteFinish: true, alwaysStat: true })
      .on('add', processMedia);

    setTimeout(postIfCan, 10000);

    gps.activate();
  } catch (e) {
    logger.error("Could not start.");
    logger.error(e);
  }
}

run();
