package expo.modules.recordingkeepalive

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal object RecordingImuController {
  const val ACTION_STOP = "expo.modules.recordingkeepalive.STOP"
  const val EXTRA_SESSION_ID = "sessionId"
  const val EXTRA_FLOOR = "floor"
  const val EXTRA_ACTIVITY = "activity"
  const val EXTRA_MOTION = "motionState"
  const val EXTRA_DEVICE_MODEL = "deviceModel"
  const val EXTRA_OS_VERSION = "osVersion"
  const val EXTRA_LOCKED_SSID = "lockedSsid"

  @Volatile var running = false
  @Volatile var writerReady = false
  @Volatile var lastSampleAtElapsed = 0L
  @Volatile var activeWriter: ImuSqliteWriter? = null

  private val startLatch = AtomicReference<CountDownLatch?>(null)
  private val stopLatch = AtomicReference<CountDownLatch?>(null)

  fun start(context: Context, options: Map<String, String?>): Boolean {
    val intent = labeledIntent(context, options)
    if (running && writerReady) {
      context.startService(intent)
      return true
    }
    val latch = CountDownLatch(1)
    startLatch.set(latch)
    writerReady = false
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    } catch (_: Exception) {
      startLatch.set(null)
      return false
    }
    return try {
      latch.await(8, TimeUnit.SECONDS) && writerReady
    } catch (_: InterruptedException) {
      writerReady
    }
  }

  fun update(context: Context, options: Map<String, String?>) {
    if (!running) {
      return
    }
    context.startService(labeledIntent(context, options))
  }

  fun stop(context: Context): Boolean {
    if (!running && activeWriter == null) {
      return true
    }
    val latch = CountDownLatch(1)
    stopLatch.set(latch)
    try {
      context.startService(Intent(context, RecordingImuService::class.java).setAction(ACTION_STOP))
    } catch (_: Exception) {
      running = false
      writerReady = false
      activeWriter = null
      stopLatch.set(null)
      return true
    }
    return try {
      latch.await(8, TimeUnit.SECONDS)
      !running && activeWriter == null
    } catch (_: InterruptedException) {
      !running
    }
  }

  fun probe(context: Context): Map<String, Boolean> {
    val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    return mapOf(
      "accelerometerAvailable" to (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null),
      "gyroscopeAvailable" to (sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null),
      "barometerAvailable" to (sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null),
    )
  }

  fun signalStart(ok: Boolean) {
    writerReady = ok && activeWriter != null
    startLatch.getAndSet(null)?.countDown()
  }

  fun countDownStop() {
    stopLatch.getAndSet(null)?.countDown()
  }

  private fun labeledIntent(context: Context, options: Map<String, String?>): Intent {
    return Intent(context, RecordingImuService::class.java)
      .putExtra(EXTRA_SESSION_ID, options["sessionId"])
      .putExtra(EXTRA_FLOOR, options["floor"])
      .putExtra(EXTRA_ACTIVITY, options["activity"])
      .putExtra(EXTRA_MOTION, options["motionState"])
      .putExtra(EXTRA_DEVICE_MODEL, options["deviceModel"])
      .putExtra(EXTRA_OS_VERSION, options["osVersion"])
      .putExtra(EXTRA_LOCKED_SSID, options["lockedSsid"])
  }
}
