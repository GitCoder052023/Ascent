package expo.modules.recordingkeepalive

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build

internal data class ConnectedWifiSnapshot(
  val connected: Boolean,
  val ssid: String?,
  val bssid: String?,
  val rssi: Int?,
  val frequency: Int?,
)

internal object ConnectedWifi {
  fun read(context: Context): ConnectedWifiSnapshot {
    return try {
      val app = context.applicationContext
      val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val wm = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val network = cm.activeNetwork
      val caps = network?.let { cm.getNetworkCapabilities(it) }
      val wifiTransport = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true

      var info: WifiInfo? = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        info = caps?.transportInfo as? WifiInfo
      }
      if (info == null || info.rssi <= -127 || info.rssi >= 0) {
        @Suppress("DEPRECATION")
        val fallback = wm.connectionInfo
        if (fallback != null) {
          if (info == null || (fallback.rssi < 0 && fallback.rssi > -127)) {
            info = fallback
          }
        }
      }

      val ssid = normalizeSsid(info?.ssid)
      val bssid = normalizeBssid(info?.bssid)
      val rssi = info?.rssi?.takeIf { it < 0 && it > -127 }
      val frequency = info?.frequency?.takeIf { it > 0 }
      val connected = wifiTransport && (ssid != null || bssid != null || rssi != null)

      ConnectedWifiSnapshot(
        connected = connected,
        ssid = ssid,
        bssid = bssid,
        rssi = rssi,
        frequency = frequency,
      )
    } catch (_: Exception) {
      ConnectedWifiSnapshot(false, null, null, null, null)
    }
  }

  fun frequencyBand(frequency: Int?): String {
    if (frequency == null) return "UNKNOWN"
    return when {
      frequency in 2400..2484 -> "2.4GHz"
      frequency in 5150..5885 -> "5GHz"
      frequency in 5925..7125 -> "6GHz"
      else -> "UNKNOWN"
    }
  }

  fun normalizedScore(rssi: Int?, frequency: Int?): Double? {
    if (rssi == null) return null
    val (minDbm, maxDbm) = when (frequencyBand(frequency)) {
      "2.4GHz" -> -92 to -28
      "5GHz" -> -88 to -32
      "6GHz" -> -84 to -35
      else -> -90 to -30
    }
    val span = (maxDbm - minDbm).toDouble()
    if (span == 0.0) return 0.0
    val score = (rssi - minDbm) / span
    return (score.coerceIn(0.0, 1.0) * 1000.0).toInt() / 1000.0
  }

  private fun normalizeSsid(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val trimmed = value.trim().trim('"')
    if (trimmed.isEmpty() || trimmed == "<unknown ssid>" || trimmed == "unknown ssid") {
      return null
    }
    return trimmed
  }

  private fun normalizeBssid(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val trimmed = value.trim()
    if (
      trimmed == "00:00:00:00:00:00" ||
      trimmed == "02:00:00:00:00:00" ||
      trimmed.equals("null", ignoreCase = true)
    ) {
      return null
    }
    return trimmed
  }
}
