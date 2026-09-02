/* global __dirname */
const fs = require("fs");
const path = require("path");
const { patchExpoSensors } = require("./androidImuPatches/sensors");
const { patchExpoLocation } = require("./androidImuPatches/location");

function patchAndroidKeepAlive(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..");
  patchExpoSensors(fs, root);
  patchExpoLocation(fs, root);
}

function withKeepAndroidImuInBackground(config) {
  const root =
    (config && config._internal && config._internal.projectRoot) || process.cwd();
  patchAndroidKeepAlive(root);
  return config;
}

module.exports = withKeepAndroidImuInBackground;
module.exports.patchExpoSensors = (projectRoot) =>
  patchExpoSensors(fs, projectRoot);
module.exports.patchExpoLocation = (projectRoot) =>
  patchExpoLocation(fs, projectRoot);
module.exports.patchAndroidKeepAlive = patchAndroidKeepAlive;

if (require.main === module) {
  patchAndroidKeepAlive(path.join(__dirname, ".."));
}
