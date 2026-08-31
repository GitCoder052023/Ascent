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

    AsyncFunction("startRecording") { options: Map<String, Any?> ->
      startImu(options.mapValues { (_, value) -> value as? String })
    }

    Function("updateLabels") { options: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@Function false
      val mapped = options.mapValues { (_, value) -> value as? String }
      RecordingImuService.update(ctx.applicationContext) {
        putString(RecordingImuService.EXTRA_SESSION_ID, mapped["sessionId"])
        putString(RecordingImuService.EXTRA_FLOOR, mapped["floor"])
        putString(RecordingImuService.EXTRA_ACTIVITY, mapped["activity"])
        putString(RecordingImuService.EXTRA_MOTION, mapped["motionState"])
        putString(RecordingImuService.EXTRA_DEVICE_MODEL, mapped["deviceModel"])
        putString(RecordingImuService.EXTRA_OS_VERSION, mapped["osVersion"])
      }
      true
    }

    AsyncFunction("stopRecording") {
      stopImu()
    }
  }

  private fun startImu(options: Map<String, String?>): Boolean {
    val ctx = appContext.reactContext ?: appContext.currentActivity ?: return false
    RecordingImuService.start(ctx.applicationContext) {
      putString(RecordingImuService.EXTRA_SESSION_ID, options["sessionId"])
      putString(RecordingImuService.EXTRA_FLOOR, options["floor"])
      putString(RecordingImuService.EXTRA_ACTIVITY, options["activity"])
      putString(RecordingImuService.EXTRA_MOTION, options["motionState"])
      putString(RecordingImuService.EXTRA_DEVICE_MODEL, options["deviceModel"])
      putString(RecordingImuService.EXTRA_OS_VERSION, options["osVersion"])
    }
    return true
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
      lastSampleAt: Long
    ) {
      instance?.get()?.sendEvent(
        "onLatest",
        mapOf(
          "accelerometer" to accelerometer,
          "gyroscope" to gyroscope,
          "barometer" to barometer,
          "motionState" to motionState,
          "lastSampleAt" to lastSampleAt,
        )
      )
    }
  }
}
