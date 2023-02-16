const _ = require('lodash');
const logger = require('./logger');
const geo = require('geolib');
const { SerialPort, ReadlineParser } = require('serialport');
const { client } = require('./db');
const course = require('./data/Black_Canyon_100K_2023.json');
// const course = require('./data/TrailThursday.json');

const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/* GSP Serial Port */
var writePort;

if (process.env.NODE_ENV === 'production') {
  try {
    writePort = new SerialPort({ path: '/dev/ttyUSB2', baudRate: 115200 });
    writePort.pipe(new ReadlineParser());
    writePort.on('error', function(err) {
      logger.error('Serial Port Error: ', err.message)
    });
    // const readPort = new SerialPort({ path: '/dev/ttyUSB1', baudRate: 115200 });
    // readPort.pipe(new ReadlineParser());
    // readPort.on('data', readGPSData);
  } catch (e) {
    logger.error("Error monitoring GPS.");
    logger.error(e);
  }
}

function activate() {
  if (process.env.NODE_ENV === 'production') {
    try {
      writePort.write('AT+QGPS=1\r');
    } catch (e) {
      logger.error("Error activating GPS.");
      logger.error(e);
    }
  }
}

function getGPS() {
  return new Promise( function (resolve, reject) {
    if (process.env.NODE_ENV === 'production') {
      try {
        writePort.write('AT+QGPSLOC?\r');
        const res = writePort.read();
        logger.info(res.toString('utf8'));
        resolve(readDirectGPSData(res));
      } catch (e) {
        logger.error("Error activating GPS.");
        logger.error(e);
        reject(e);
      }
    } else {
      resolve({});
    }
  });
}

function distanceFromStart(point) {
  const route = _.find(course.features, { geometry: { type: "LineString" } });
  const nearestPoint = geo.findNearest(point, route.geometry.coordinates);
  if (!geo.isPointWithinRadius(point, nearestPoint, 1000)) { return -1; }

  const index = _.findIndex(route.geometry.coordinates, function (a) { return a[0] === nearestPoint[0] && a[1] === nearestPoint[1]; });
  const distanceM = geo.getPathLength(route.geometry.coordinates.slice(0, index));
  return distanceM/1000; // meters to km
}

function isCloseToPoint(point) {
  for (var i = 0; i < course.features.length; i++) {
    if (course.features[i].geometry.type !== "Point") continue;

    if (geo.isPointWithinRadius(point, course.features[i].geometry.coordinates, 100)) {
      return course.features[i].properties.title;
    }
  }

  return "";
}

function readDirectGPSData(data) {
  const str = data.toString('utf8');
  const regex = /QGPSLOC: (\d*).*?,(\d*.?\d*)(\w),(\d*.?\d*)(\w),.*?,.*?,.*?,.*?,.*?,.*?,(\d*)/g;
  const matches = regex.exec(str);
  if (_.isEmpty(matches)) return {};

  const time = matches[1].slice(0,2) + ":" + matches[1].slice(2,4) + ":" + matches[1].slice(4,6);
  const date = matches[6].slice(0,2) + "/" + matches[6].slice(2,4) + "/" + matches[6].slice(4,6);
  const dirLat = matches[3];
  const lat = decodeGeo(matches[2], dirLat);
  const dirLon = matches[5];
  const lon = decodeGeo(matches[4], dirLon);
  const dist = distanceFromStart([lon, lat]);
  const title = buildTitle(dist, isCloseToPoint([lon, lat]));
  logger.info(`lat: ${lat}, lon: ${lon}, time: ${time}, date: ${date}, dist: ${dist}, title: ${title}`);
  return { lon, lat, time, date, dist, title };
}

function readGPSData(data) {
  const str = data.toString('utf8');
  const matches = str.match(/(\$GPRMC,.+?,.+?,.+?,.+?,.+?,.+?,.+?,.+?,.+?),/g);
  if (_.isEmpty(matches)) return;

  const pick = matches[matches.length-1];
  const datas = pick.split(',');
  if (datas[2] === 'V') return;

  const time = datas[1].slice(0,2) + ":" + datas[1].slice(2,4) + ":" + datas[1].slice(4,6);
  const date = datas[9].slice(0,2) + "/" + datas[9].slice(2,4) + "/" + datas[9].slice(4,6);
  const dirLat = datas[4];
  const lat = decodeGeo(datas[3], dirLat);
  const dirLon = datas[6];
  const lon = decodeGeo(datas[5], dirLon);
  const dist = distanceFromStart([lon, lat]);
  const title = buildTitle(dist, isCloseToPoint([lon, lat]));
  logger.info(`lat: ${lat}, lon: ${lon}, time: ${time}, date: ${date}, dist: ${dist}, title: ${title}`);
  saveGPSData({ lon, lat, time, date, dist, title });
}

function buildTitle(dist, pointTitle) {
  if (dist === -1) {
    return "Not on course."
  }

  var title = "Near " + pointTitle;
  if (pointTitle !== "") {
    title += ". ";
  }

  title += formatter.format(dist) + "km - " + formatter.format(dist * 0.6214) + "mi in. " + Math.ceil(dist/100) + "% done!";
}

function decodeGeo(data, dir) {
  const x = data.split('.');
  const head = x[0];
  const tail = x[1];
  const deg = head.slice(0,-2);
  const min = head.slice(-2);
  return (parseInt(deg) + parseFloat(min + '.' + tail)/60) * (dir === 'W' || dir === 'S' ? -1 : 1);
}

async function saveGPSData(data) {
  try {
    await client.hSet("gps", "lat", data.lat);
    await client.hSet("gps", "lon", data.lon);
    await client.hSet("gps", "time", data.time);
    await client.hSet("gps", "date", data.date);
    await client.hSet("gps", "dist", data.dist);
    await client.hSet("gps", "title", data.title);
  } catch (e) {
  }
}

async function getData() {
  return client.hGetAll("gps");
}

module.exports = {
  activate,
  getData,
  getGPS
};
