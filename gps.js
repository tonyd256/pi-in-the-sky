const _ = require('lodash');
const logger = require('./logger');
const geo = require('geolib');
const { SerialPort, ReadlineParser } = require('serialport');
const { client } = require('./db');
const course = require('./data/Black_Canyon_100K_2023.json');

/* GSP Serial Port */

if (process.env.NODE_ENV === 'production') {
  try {
    const readPort = new SerialPort({ path: '/dev/ttyUSB1', baudRate: 115200 });
    readPort.pipe(new ReadlineParser());
    readPort.on('data', readGPSData);
  } catch (e) {
    logger.error("Error monitoring GPS.");
    logger.error(e);
  }
}

function activate() {
  if (process.env.NODE_ENV === 'production') {
    try {
      const writePort = new SerialPort({ path: '/dev/ttyUSB2', baudRate: 115200 });
      writePort.write('AT+QGPS=1\r');
      writePort.close();
    } catch (e) {
      logger.error("Error activating GPS.");
      logger.error(e);
    }
  }
}

function distanceFromStart(point) {
  const nearestPoint = geo.findNearest(point, course.features[11].geometry.coordinates);
  const index = _.findIndex(course.features[11].geometry.coordinates, function (a) { return a[0] === nearestPoint[0] && a[1] === nearestPoint[1]; });
  const distanceM = geo.getPathLength(course.features[11].geometry.coordinates.slice(0, index));
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

function readGPSData(data) {
  if (!data.startsWith('$GPRMC')) return;
  const datas = data.split(',');
  if (datas[2] === 'V') return;

  const time = datas[1].slice(0,2) + ":" + datas[1].slice(2,4) + ":" + datas[1].slice(4,6);
  const date = datas[9].slice(0,2) + "/" + datas[9].slice(2,4) + "/" + datas[9].slice(4,6);
  const dirLat = datas[4];
  const lat = decodeGeo(datas[3], dirLat);
  const dirLon = datas[6];
  const lon = decodeGeo(datas[5], dirLon);
  saveGPSData({ lon, lat, time, date, dist: distanceFromStart([lon, lat]), title: isCloseToPoint([lon, lat]) });
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
  getData
};
