package expo.modules.recordingkeepalive

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal data class PresenceSnapshot(
  val appState: String,
  val lockScreen: String,
  val screenOn: String,
)

internal object DevicePresence {
  private val registered = AtomicBoolean(false)
  private val resumedActivityIds = ConcurrentHashMap.newKeySet<Int>()

  fun ensureRegistered(context: Context, currentActivity: Activity? = null) {
    val app = context.applicationContext as? Application ?: return
    if (!registered.compareAndSet(false, true)) {
      return
    }
    if (currentActivity != null && !currentActivity.isFinishing) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1 || !currentActivity.isDestroyed) {
        resumedActivityIds.add(System.identityHashCode(currentActivity))
      }
    }
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityResumed(activity: Activity) {
        resumedActivityIds.add(System.identityHashCode(activity))
      }

      override fun onActivityPaused(activity: Activity) {
        resumedActivityIds.remove(System.identityHashCode(activity))
      }

      override fun onActivityDestroyed(activity: Activity) {
        resumedActivityIds.remove(System.identityHashCode(activity))
      }

      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
      override fun onActivityStarted(activity: Activity) = Unit
      override fun onActivityStopped(activity: Activity) = Unit
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
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
    // If the display is off, the user is not actively in the app.
    if (!isScreenOn(context)) {
      return false
    }
    // If the lock screen is active, the app cannot be in active interactive foreground.
    if (isLockScreen(context)) {
      return false
    }
    // Only use the direct activity-resumed check. The RunningAppProcessInfo
    // fallback was wrong because processes running a foreground service always
    // have IMPORTANCE_FOREGROUND, making it return true even when the user is
    // in another app or on the lock screen.
    return resumedActivityIds.isNotEmpty()
  }

  private fun isLockScreen(context: Context): Boolean {
    return try {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      // If screen is not interactive (turned off), the device is locked/sleeping
      if (!pm.isInteractive) {
        return true
      }
      val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      if (km.isKeyguardLocked) {
        return true
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1 && km.isDeviceLocked) {
        return true
      }
      @Suppress("DEPRECATION")
      if (km.inKeyguardRestrictedInputMode()) {
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
