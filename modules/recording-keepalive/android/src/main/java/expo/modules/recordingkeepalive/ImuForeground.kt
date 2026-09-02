package expo.modules.recordingkeepalive

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build

internal object ImuForeground {
  private const val NOTIFICATION_ID = 481757
  private const val CHANNEL_ID = "ascent-imu"

  fun enter(service: Service) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Ascent IMU recording",
        NotificationManager.IMPORTANCE_LOW
      )
      channel.setShowBadge(false)
      service.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    val launch = service.packageManager.getLaunchIntentForPackage(service.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pending = if (launch != null) {
      val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      PendingIntent.getActivity(service, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    } else {
      null
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(service, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(service)
    }
    val notification = builder
      .setContentTitle("Ascent IMU")
      .setContentText("Native IMU and connected Wi-Fi are recording.")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pending)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()
    val locationOk = service.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    val candidates = ArrayList<Int>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      if (locationOk) {
        candidates.add(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      }
      candidates.add(ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
      if (locationOk) {
        candidates.add(
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        )
      }
    }
    var started = false
    for (types in candidates) {
      try {
        service.startForeground(NOTIFICATION_ID, notification, types)
        started = true
        break
      } catch (_: Exception) {
        // Try the next declared FGS type.
      }
    }
    if (!started) {
      try {
        service.startForeground(NOTIFICATION_ID, notification)
      } catch (_: Exception) {
        // Keep sampling even if the notification type is rejected.
      }
    }
  }
}
