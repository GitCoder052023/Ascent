package expo.modules.recordingkeepalive

import kotlin.math.sqrt

internal class MotionTracker {
  var gravityEstimate = 1.0
  var lastWalkAt = 0L
  var motionState = "STATIONARY"
    private set

  fun onAccelerometer(x: Double, y: Double, z: Double, now: Long): String {
    val magnitude = sqrt(x * x + y * y + z * z)
    gravityEstimate = 0.85 * gravityEstimate + 0.15 * magnitude
    if (kotlin.math.abs(magnitude - gravityEstimate) > 0.045) {
      lastWalkAt = now
    }
    motionState = if (now - lastWalkAt < 6000L) "WALKING" else "STATIONARY"
    return motionState
  }

  fun applyExternal(state: String?) {
    if (!state.isNullOrEmpty()) {
      motionState = state
    }
  }
}
