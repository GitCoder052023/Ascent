/* global __dirname */
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

function locationAndroidFile(projectRoot, ...parts) {
  return path.join(
    projectRoot,
    "node_modules",
    "expo-location",
    "android",
    "src",
    "main",
    ...parts
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

const STOCK_LOCATION_DEFER = `    // Foreground: report immediately for responsive UI (matches iOS behavior)
    if (!mIsHostPaused) {
      reportLocationsImmediately(locations)
      return
    }

    // Background: use deferred buffer for battery optimization
    deferLocations(locations)
    maybeReportDeferredLocations()`;

const PATCHED_LOCATION_DEFER = `    // Always deliver immediately so the JS runtime (and IMU revival) is not
    // waiting on deferred JobScheduler batches while the Activity is paused.
    reportLocationsImmediately(locations)`;

const STOCK_NOTIFICATION_BUILD = `    return builder.setCategory(Notification.CATEGORY_SERVICE)
      .setSmallIcon(iconsResId)
      .build()`;

const PATCHED_NOTIFICATION_BUILD = `    return builder.setCategory(Notification.CATEGORY_SERVICE)
      .setSmallIcon(iconsResId)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()`;

const STOCK_LOCATION_SERVICE = `      android:exported="false"
      android:foregroundServiceType="location" />`;

const PATCHED_LOCATION_SERVICE = `      android:exported="false"
      android:stopWithTask="false"
      android:foregroundServiceType="location" />`;

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
    sensorsAndroidFile(root, "SensorProxy.kt"),
    STOCK_DESTROY,
    PATCHED_DESTROY,
    "Activity destroy is not process death"
  );
  const subscription = sensorsAndroidFile(root, "SensorSubscription.kt");
  patchFile(
    subscription,
    STOCK_DELAY,
    PATCHED_DELAY,
    "get() = SensorManager.SENSOR_DELAY_FASTEST"
  );
  patchFile(
    subscription,
    `  private val samplingPeriodUs: Int
    get() = SensorManager.SENSOR_DELAY_GAME`,
    PATCHED_DELAY,
    "get() = SensorManager.SENSOR_DELAY_FASTEST"
  );
  patchFile(
    subscription,
    STOCK_REGISTER,
    PATCHED_REGISTER,
    "samplingPeriodUs, 5000000)"
  );
}

function patchExpoLocation(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..");
  patchFile(
    locationAndroidFile(
      root,
      "java",
      "expo",
      "modules",
      "location",
      "taskConsumers",
      "LocationTaskConsumer.kt"
    ),
    STOCK_LOCATION_DEFER,
    PATCHED_LOCATION_DEFER,
    "Always deliver immediately so the JS runtime"
  );
  patchFile(
    locationAndroidFile(
      root,
      "java",
      "expo",
      "modules",
      "location",
      "services",
      "LocationTaskService.kt"
    ),
    STOCK_NOTIFICATION_BUILD,
    PATCHED_NOTIFICATION_BUILD,
    "setOngoing(true)"
  );
  patchFile(
    locationAndroidFile(root, "AndroidManifest.xml"),
    STOCK_LOCATION_SERVICE,
    PATCHED_LOCATION_SERVICE,
    'android:stopWithTask="false"'
  );
}

function patchAndroidKeepAlive(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..");
  patchExpoSensors(root);
  patchExpoLocation(root);
}

function withKeepAndroidImuInBackground(config) {
  const root =
    (config && config._internal && config._internal.projectRoot) || process.cwd();
  patchAndroidKeepAlive(root);
  return config;
}

module.exports = withKeepAndroidImuInBackground;
module.exports.patchExpoSensors = patchExpoSensors;
module.exports.patchExpoLocation = patchExpoLocation;
module.exports.patchAndroidKeepAlive = patchAndroidKeepAlive;

if (require.main === module) {
  patchAndroidKeepAlive(path.join(__dirname, ".."));
}
