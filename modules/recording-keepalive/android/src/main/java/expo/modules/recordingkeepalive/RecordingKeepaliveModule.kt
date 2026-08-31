package expo.modules.recordingkeepalive

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RecordingKeepaliveModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("RecordingKeepalive")

    Function("acquire") {
      val ctx = context ?: return@Function false
      val held = wakeLock
      if (held?.isHeld == true) {
        return@Function true
      }
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ascent:recording")
      lock.setReferenceCounted(false)
      lock.acquire()
      wakeLock = lock
      true
    }

    Function("release") {
      val lock = wakeLock
      if (lock?.isHeld == true) {
        lock.release()
      }
      wakeLock = null
      true
    }

    Function("isHeld") {
      wakeLock?.isHeld == true
    }

    Function("isIgnoringBatteryOptimizations") {
      val ctx = context ?: return@Function false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val activity = appContext.currentActivity
      val ctx = activity ?: context ?: return@AsyncFunction false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
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
  }
}
