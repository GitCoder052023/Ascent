package expo.modules.recordingkeepalive

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.content.Context

internal object BatteryExemption {
  fun isIgnoring(context: Context): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(context.packageName)
  }

  fun request(context: Context, fromActivity: Boolean): Boolean {
    if (isIgnoring(context)) {
      return true
    }
    val packageUri = Uri.parse("package:${context.packageName}")
    try {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = packageUri
        if (!fromActivity) {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      }
      context.startActivity(intent)
    } catch (_: Exception) {
      val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
        if (!fromActivity) {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      }
      context.startActivity(fallback)
    }
    return false
  }
}
