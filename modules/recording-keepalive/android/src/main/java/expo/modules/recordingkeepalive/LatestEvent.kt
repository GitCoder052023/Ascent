package expo.modules.recordingkeepalive

internal object LatestEvent {
  fun payload(
    accelerometer: String?,
    gyroscope: String?,
    barometer: String?,
    motionState: String,
    lastSampleAt: Long,
    wifiConnectionState: String?,
    wifiSsid: String?,
    wifiBssid: String?,
    wifiRssi: Int?,
    wifiFrequency: Int?,
    wifiTimestamp: String?,
    wifiSsidMismatch: Boolean,
    appState: String?,
    lockScreen: String?,
    screenOn: String?,
  ): Map<String, Any?> {
    return mapOf(
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
      "appState" to appState,
      "lockScreen" to lockScreen,
      "screenOn" to screenOn,
    )
  }
}
