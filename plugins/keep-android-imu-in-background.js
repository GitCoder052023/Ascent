const fs = require("fs");
const path = require("path");

function sensorsAndroidFile(projectRoot, name) {
  return path.join(
    projectRoot,
    "node_modules",
    "expo-sensors",
    "android",
    "src",
    "main",
    "java",
    "expo",
    "modules",
    "sensors",
    name
  );
}

const STOCK_PAUSE = `  fun onHostPause() {
    if (isObserving) {
      sensorKernelServiceSubscription.stopObserving()
    }
  }`;

const PATCHED_PAUSE = `  fun onHostPause() {
    // Keep SensorManager registered while JS listeners exist. Unregistering here
    // drops IMU/barometer the moment Android pauses the Activity (Home, recents,
    // lock screen), even if a location foreground service is still running.
  }`;

const STOCK_DELAY = `  private val samplingPeriodUs: Int
    get() = if (hasHighSamplingRateSensorsPermission()) {
      SensorManager.SENSOR_DELAY_FASTEST
    } else {
      SensorManager.SENSOR_DELAY_NORMAL
    }`;

const PATCHED_DELAY = `  private val samplingPeriodUs: Int
    get() = SensorManager.SENSOR_DELAY_GAME`;

function patchFile(target, stock, patched, alreadyMarker) {
  if (!fs.existsSync(target)) {
    return;
  }
  const source = fs.readFileSync(target, "utf8");
  if (source.includes(alreadyMarker)) {
    return;
  }
  if (!source.includes(stock)) {
    return;
  }
  fs.writeFileSync(target, source.replace(stock, patched));
}

function patchExpoSensors(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..");
  patchFile(
    sensorsAndroidFile(root, "SensorProxy.kt"),
    STOCK_PAUSE,
    PATCHED_PAUSE,
    "Keep SensorManager registered while JS listeners exist"
  );
  patchFile(
    sensorsAndroidFile(root, "SensorSubscription.kt"),
    STOCK_DELAY,
    PATCHED_DELAY,
    "SENSOR_DELAY_GAME"
  );
}

function withKeepAndroidImuInBackground(config) {
  const root =
    (config && config._internal && config._internal.projectRoot) || process.cwd();
  patchExpoSensors(root);
  return config;
}

module.exports = withKeepAndroidImuInBackground;
module.exports.patchExpoSensors = patchExpoSensors;

if (require.main === module) {
  patchExpoSensors(path.join(__dirname, ".."));
}
