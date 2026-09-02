/* global __dirname */
const path = require("path");
const { patchFile } = require("./patchFile");

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

const STOCK_DESTROY = `  fun onHostDestroy() {
    if (isObserving) {
      sensorKernelServiceSubscription.stopObserving()
      isObserving = false
    }
  }`;

const PATCHED_DESTROY = `  fun onHostDestroy() {
    // Activity destroy is not process death. The location FGS can keep this
    // process (and JS listeners) alive; unregistering here would drop IMU.
  }`;

const STOCK_DELAY = `  private val samplingPeriodUs: Int
    get() = if (hasHighSamplingRateSensorsPermission()) {
      SensorManager.SENSOR_DELAY_FASTEST
    } else {
      SensorManager.SENSOR_DELAY_NORMAL
    }`;

const PATCHED_DELAY = `  private val samplingPeriodUs: Int
    get() = SensorManager.SENSOR_DELAY_FASTEST`;

const STOCK_REGISTER = `      mSensorManager.registerListener(this, mSensor, samplingPeriodUs)`;

const PATCHED_REGISTER = `      mSensorManager.registerListener(this, mSensor, samplingPeriodUs, 5000000)`;

function patchExpoSensors(fs, projectRoot) {
  const root = projectRoot || path.join(__dirname, "..", "..");
  patchFile(
    fs,
    sensorsAndroidFile(root, "SensorProxy.kt"),
    STOCK_PAUSE,
    PATCHED_PAUSE,
    "Keep SensorManager registered while JS listeners exist"
  );
  patchFile(
    fs,
    sensorsAndroidFile(root, "SensorProxy.kt"),
    STOCK_DESTROY,
    PATCHED_DESTROY,
    "Activity destroy is not process death"
  );
  const subscription = sensorsAndroidFile(root, "SensorSubscription.kt");
  patchFile(
    fs,
    subscription,
    STOCK_DELAY,
    PATCHED_DELAY,
    "get() = SensorManager.SENSOR_DELAY_FASTEST"
  );
  patchFile(
    fs,
    subscription,
    `  private val samplingPeriodUs: Int
    get() = SensorManager.SENSOR_DELAY_GAME`,
    PATCHED_DELAY,
    "get() = SensorManager.SENSOR_DELAY_FASTEST"
  );
  patchFile(
    fs,
    subscription,
    STOCK_REGISTER,
    PATCHED_REGISTER,
    "samplingPeriodUs, 5000000)"
  );
}

module.exports = { patchExpoSensors };
