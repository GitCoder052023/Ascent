package expo.modules.recordingkeepalive

import android.os.PowerManager
import android.os.SystemClock
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
      val ctx = appContext.reactContext ?: appContext.currentActivity
      if (ctx != null) {
        DevicePresence.ensureRegistered(ctx, appContext.currentActivity)
      }
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
      RecordingImuController.running
    }

    Function("lastSampleAgeMs") {
      if (!RecordingImuController.running) {
        return@Function 10_000_000L
      }
      if (RecordingImuController.lastSampleAtElapsed == 0L) {
        return@Function 0L
      }
      (SystemClock.elapsedRealtime() - RecordingImuController.lastSampleAtElapsed).coerceAtMost(10_000_000L)
    }

    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: return@Function false
      BatteryExemption.isIgnoring(ctx)
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val activity = appContext.currentActivity
      val ctx = activity ?: appContext.reactContext ?: return@AsyncFunction false
      BatteryExemption.request(ctx, activity != null)
    }

    Function("probeAvailability") {
      val ctx = appContext.reactContext ?: return@Function mapOf(
        "accelerometerAvailable" to false,
        "gyroscopeAvailable" to false,
        "barometerAvailable" to false,
      )
      RecordingImuService.probe(ctx)
    }

    Function("presence") {
      val ctx = appContext.reactContext ?: appContext.currentActivity ?: return@Function mapOf(
        "appState" to "BACKGROUND",
        "lockScreen" to "UNKNOWN",
        "screenOn" to "UNKNOWN",
      )
      DevicePresence.ensureRegistered(ctx, appContext.currentActivity)
      DevicePresence.asMap(ctx)
    }

    Function("rawCount") {
      val count = RecordingImuController.activeWriter?.observationCount()
      if (count != null && count >= 0L) count else 0L
    }

    Function("wifiCount") {
      val count = RecordingImuController.activeWriter?.wifiCount()
      if (count != null && count >= 0L) count else 0L
    }

    AsyncFunction("flushWrites") {
      RecordingImuController.activeWriter?.let { writer ->
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
    DevicePresence.ensureRegistered(ctx, appContext.currentActivity)
    return RecordingImuService.start(ctx.applicationContext, options)
  }

  private fun stopImu(): Boolean {
    val ctx = appContext.reactContext ?: appContext.currentActivity ?: return true
    return RecordingImuService.stop(ctx.applicationContext)
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
      appState: String? = null,
      lockScreen: String? = null,
      screenOn: String? = null,
    ) {
      instance?.get()?.sendEvent(
        "onLatest",
        LatestEvent.payload(
          accelerometer,
          gyroscope,
          barometer,
          motionState,
          lastSampleAt,
          wifiConnectionState,
          wifiSsid,
          wifiBssid,
          wifiRssi,
          wifiFrequency,
          wifiTimestamp,
          wifiSsidMismatch,
          appState,
          lockScreen,
          screenOn,
        )
      )
    }
  }
}
