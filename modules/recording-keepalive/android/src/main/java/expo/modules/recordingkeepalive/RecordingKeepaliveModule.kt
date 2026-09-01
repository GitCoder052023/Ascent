package expo.modules.recordingkeepalive

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class RecordingKeepaliveModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun definition() = ModuleDefinition {
    Name("RecordingKeepalive")

    Events("onLatest")

    OnCreate {
      instance = WeakReference(this@RecordingKeepaliveModule)
    }

    OnDestroy {
      if (instance?.get() === this@RecordingKeepaliveModule) {
        instance = null
      }
    }

    Function("acquire") {
      val ctx = appContext.reactContext ?: return@Function false
      if (wakeLock?.isHeld == true) {
        return@Function true
      }
      val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ascent:recording")
      lock.setReferenceCounted(false)
      lock.acquire()
      wakeLock = lock
      true
    }

    Function("release") {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
      wakeLock = null
      true
    }

    Function("isHeld") {
      wakeLock?.isHeld == true
    }

    Function("isRecording") {
      RecordingImuService.running
    }

    Function("lastSampleAgeMs") {
      if (!RecordingImuService.running) {
        return@Function 10_000_000L
      }
      if (RecordingImuService.lastSampleAtElapsed == 0L) {
        return@Function 0L
      }
      (SystemClock.elapsedRealtime() - RecordingImuService.lastSampleAtElapsed).coerceAtMost(10_000_000L)
    }

    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: return@Function false
      val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val activity = appContext.currentActivity
      val ctx = activity ?: appContext.reactContext ?: return@AsyncFunction false
      val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
        return@AsyncFunction true
      }
      val packageUri = Uri.parse("package:${ctx.packageName}")
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = packageUri
          if (activity == null) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        }
        ctx.startActivity(intent)
      } catch (_: Exception) {
        val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          if (activity == null) {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        }
        ctx.startActivity(fallback)
      }
      false
    }

    Function("probeAvailability") {
      val ctx = appContext.reactContext ?: return@Function mapOf(
        "accelerometerAvailable" to false,
        "gyroscopeAvailable" to false,
        "barometerAvailable" to false,
      )
      RecordingImuService.probe(ctx)
    }

    Function("rawCount") {
      RecordingImuService.activeWriter?.observationCount() ?: -1L
    }

    AsyncFunction("flushWrites") {
      RecordingImuService.activeWriter?.let { writer ->
        writer.flushBlocking()
        writer.checkpoint("PASSIVE")
        true
      } ?: false
    }

    AsyncFunction("startRecording") { options: Map<String, Any?> ->
      startImu(options.mapValues { (_, value) -> value as? String })
    }

    Function("updateLabels") { options: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@Function false
      RecordingImuService.update(
        ctx.applicationContext,
        options.mapValues { (_, value) -> value as? String }
      )
      true
    }

    AsyncFunction("stopRecording") {
      stopImu()
    }
  }

  private fun startImu(options: Map<String, String?>): Boolean {
    val ctx = appContext.reactContext ?: appContext.currentActivity ?: return false
    return RecordingImuService.start(ctx.applicationContext, options)
  }

  private fun stopImu(): Boolean {
    val ctx = appContext.reactContext ?: appContext.currentActivity ?: return false
    RecordingImuService.stop(ctx.applicationContext)
    return true
  }

  companion object {
    private var instance: WeakReference<RecordingKeepaliveModule>? = null

    fun emitLatest(
      accelerometer: String?,
      gyroscope: String?,
      barometer: String?,
      motionState: String,
      lastSampleAt: Long,
      wifiConnectionState: String? = null,
      wifiSsid: String? = null,
      wifiBssid: String? = null,
      wifiRssi: Int? = null,
      wifiFrequency: Int? = null,
      wifiTimestamp: String? = null,
      wifiSsidMismatch: Boolean = false,
    ) {
      instance?.get()?.sendEvent(
        "onLatest",
        mapOf(
          "accelerometer" to accelerometer,
          "gyroscope" to gyroscope,
          "barometer" to barometer,
          "motionState" to motionState,
          "lastSampleAt" to lastSampleAt,
          "wifiConnectionState" to wifiConnectionState,
          "wifiSsid" to wifiSsid,
          "wifiBssid" to wifiBssid,
          "wifiRssi" to wifiRssi,
          "wifiFrequency" to wifiFrequency,
          "wifiTimestamp" to wifiTimestamp,
          "wifiSsidMismatch" to wifiSsidMismatch,
        )
      )
    }
  }
}
