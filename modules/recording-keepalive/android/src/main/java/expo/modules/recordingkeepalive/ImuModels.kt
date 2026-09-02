package expo.modules.recordingkeepalive

internal data class ImuSample(
  val sensorType: String,
  val arrivalMs: Long,
  val sensorTimestampSec: Double,
  val x: Double? = null,
  val y: Double? = null,
  val z: Double? = null,
  val pressure: Double? = null,
  val ssid: String? = null,
  val bssid: String? = null,
  val rssi: Double? = null,
  val frequency: Int? = null,
  val appState: String? = null,
  val lockScreen: String? = null,
  val screenOn: String? = null,
)

internal data class RecordingLabels(
  val sessionId: String?,
  val floor: String?,
  val activity: String?,
  val motionState: String?,
  val deviceModel: String?,
  val osVersion: String?,
)
