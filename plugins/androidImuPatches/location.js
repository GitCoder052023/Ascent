/* global __dirname */
const path = require("path");
const { patchFile } = require("./patchFile");

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

function patchExpoLocation(fs, projectRoot) {
  const root = projectRoot || path.join(__dirname, "..", "..");
  patchFile(
    fs,
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
    fs,
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
    fs,
    locationAndroidFile(root, "AndroidManifest.xml"),
    STOCK_LOCATION_SERVICE,
    PATCHED_LOCATION_SERVICE,
    'android:stopWithTask="false"'
  );
}

module.exports = { patchExpoLocation };
