package expo.modules.recordingkeepalive

import android.app.Activity
import android.app.Application
import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

internal data class PresenceSnapshot(
  val appState: String,
  val lockScreen: String,
  val screenOn: String,
)

internal object DevicePresence {
  private val registered = AtomicBoolean(false)
  private val startedActivities = AtomicInteger(0)

  fun ensureRegistered(context: Context, currentActivity: Activity? = null) {
    val app = context.applicationContext as? Application ?: return
    if (!registered.compareAndSet(false, true)) {
      return
    }
    if (currentActivity != null) {
      startedActivities.set(1)
    }
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        startedActivities.incrementAndGet()
      }

      override fun onActivityStopped(activity: Activity) {
        startedActivities.updateAndGet { value -> (value - 1).coerceAtLeast(0) }
      }

      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
      override fun onActivityResumed(activity: Activity) = Unit
      override fun onActivityPaused(activity: Activity) = Unit
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
      override fun onActivityDestroyed(activity: Activity) = Unit
    })
  }

  fun snapshot(context: Context): PresenceSnapshot {
    val app = context.applicationContext
    return PresenceSnapshot(
      appState = if (isForeground(app)) "FOREGROUND" else "BACKGROUND",
      lockScreen = if (isLockScreen(app)) "YES" else "NO",
      screenOn = if (isScreenOn(app)) "YES" else "NO",
    )
  }

  fun asMap(context: Context): Map<String, String> {
    val snap = snapshot(context)
    return mapOf(
      "appState" to snap.appState,
      "lockScreen" to snap.lockScreen,
      "screenOn" to snap.screenOn,
    )
  }

  private fun isForeground(context: Context): Boolean {
    if (startedActivities.get() > 0) {
      return true
    }
    return try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val pkg = context.packageName
      am.runningAppProcesses.orEmpty().any { process ->
        process.processName == pkg &&
          process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
      }
    } catch (_: Exception) {
      false
    }
  }

  private fun isLockScreen(context: Context): Boolean {
    return try {
      val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      if (km.isKeyguardLocked) {
        return true
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 && km.isDeviceLocked) {
        return true
      }
      false
    } catch (_: Exception) {
      false
    }
  }

  private fun isScreenOn(context: Context): Boolean {
    return try {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isInteractive
    } catch (_: Exception) {
      false
    }
  }
}
