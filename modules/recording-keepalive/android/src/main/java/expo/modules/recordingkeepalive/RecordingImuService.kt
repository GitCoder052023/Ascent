package expo.modules.recordingkeepalive

import android.app.Service
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicReference

class RecordingImuService : Service(), SensorEventListener {
  private var sensorManager: SensorManager? = null
  private var sensorThread: HandlerThread? = null
  private var writer: ImuSqliteWriter? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var stopping = false
  private val mainHandler = Handler(Looper.getMainLooper())
  private var accel: Sensor? = null
  private var gyro: Sensor? = null
  private var baro: Sensor? = null
  private val motion = MotionTracker()

  private var lastAccelAt = 0L
  private var lastGyroAt = 0L
  private var lastBaroAt = 0L
  private var lastUiAt = 0L
  private var lastAccelIso: String? = null
  private var lastGyroIso: String? = null
  private var lastBaroIso: String? = null
  private var wifiHandler: Handler? = null
  private var wifiScheduled = false
  private var lockedSsid: String? = null
  private var lastWifi: ConnectedWifiSnapshot? = null
  private var lastWifiIso: String? = null
  private val currentWifi = AtomicReference(
    ConnectedWifiSnapshot(false, null, null, null, null)
  )
  private var wifiSsidMismatch = false
  private var wifiHandlerThread: HandlerThread? = null
  private val lastPresence = AtomicReference(
    PresenceSnapshot("FOREGROUND", "NO", "YES")
  )

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    stopping = false
    ImuForeground.enter(this)
    try {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ascent:imu").apply {
        setReferenceCounted(false)
        acquire()
      }
      val sqlite = ImuSqliteWriter(this)
      if (!sqlite.start()) {
        RecordingImuController.signalStart(false)
        stopSelf()
        return
      }
      DevicePresence.ensureRegistered(this)
      val initialWifi = ConnectedWifi.read(this)
      currentWifi.set(initialWifi)
      lastWifi = initialWifi
      writer = sqlite
      RecordingImuController.activeWriter = sqlite
      sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
      accel = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      gyro = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
      baro = sensorManager?.getDefaultSensor(Sensor.TYPE_PRESSURE)
      val thread = HandlerThread("ascent-imu-sensors").also { it.start() }
      sensorThread = thread
      val handler = Handler(thread.looper)
      accel?.let { registerSensor(it, handler) }
      gyro?.let { registerSensor(it, handler) }
      baro?.let { registerSensor(it, handler) }
      val wThread = HandlerThread("ascent-wifi").also { it.start() }
      wifiHandlerThread = wThread
      wifiHandler = Handler(wThread.looper)
      wifiScheduled = true
      wifiHandler?.post(wifiTick)
      RecordingImuController.running = true
      RecordingImuController.signalStart(true)
    } catch (_: Exception) {
      RecordingImuController.running = false
      RecordingImuController.signalStart(false)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == RecordingImuController.ACTION_STOP) {
      stopInternal()
      return START_NOT_STICKY
    }
    ImuForeground.enter(this)
    applyLabels(intent)
    if (writer != null) {
      RecordingImuController.running = true
      RecordingImuController.signalStart(true)
    }
    if (!wifiScheduled) {
      wifiScheduled = true
      wifiHandler?.post(wifiTick)
    }
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    stopInternal()
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Keep sampling after swipe-away while the process/FGS still exists.
  }

  override fun onSensorChanged(event: SensorEvent) {
    val now = System.currentTimeMillis()
    val sensorTimestamp = event.timestamp / 1_000_000_000.0
    when (event.sensor.type) {
      Sensor.TYPE_ACCELEROMETER -> {
        if (now - lastAccelAt < ACCEL_INTERVAL_MS) return
        lastAccelAt = now
        val x = event.values[0] / SensorManager.GRAVITY_EARTH
        val y = event.values[1] / SensorManager.GRAVITY_EARTH
        val z = event.values[2] / SensorManager.GRAVITY_EARTH
        val motionState = motion.onAccelerometer(x.toDouble(), y.toDouble(), z.toDouble(), now)
        writer?.let { w ->
          w.labels = w.labels.copy(motionState = motionState)
          enqueueSample(
            ImuSample("accelerometer", now, sensorTimestamp, x.toDouble(), y.toDouble(), z.toDouble(), null)
          )
        }
        lastAccelIso = IsoUtc.format(now)
        maybeEmit(now)
      }
      Sensor.TYPE_GYROSCOPE -> {
        if (now - lastGyroAt < GYRO_INTERVAL_MS) return
        lastGyroAt = now
        enqueueSample(
          ImuSample(
            "gyroscope",
            now,
            sensorTimestamp,
            event.values[0].toDouble(),
            event.values[1].toDouble(),
            event.values[2].toDouble(),
            null
          )
        )
        lastGyroIso = IsoUtc.format(now)
        maybeEmit(now)
      }
      Sensor.TYPE_PRESSURE -> {
        if (now - lastBaroAt < BARO_INTERVAL_MS) return
        lastBaroAt = now
        val pressure = event.values[0].toDouble()
        if (!pressure.isFinite()) return
        enqueueSample(ImuSample("barometer", now, sensorTimestamp, null, null, null, pressure))
        lastBaroIso = IsoUtc.format(now)
        maybeEmit(now)
      }
    }
    RecordingImuController.lastSampleAtElapsed = SystemClock.elapsedRealtime()
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun maybeEmit(now: Long) {
    if (now - lastUiAt < 750) {
      return
    }
    lastUiAt = now
    mainHandler.post {
      emitUi(now)
    }
  }

  private fun applyLabels(intent: Intent?) {
    if (intent == null) {
      return
    }
    fun extra(key: String): String? = intent.getStringExtra(key)?.takeIf { it.isNotEmpty() }
    writer?.labels = RecordingLabels(
      sessionId = extra(RecordingImuController.EXTRA_SESSION_ID),
      floor = extra(RecordingImuController.EXTRA_FLOOR),
      activity = extra(RecordingImuController.EXTRA_ACTIVITY),
      motionState = extra(RecordingImuController.EXTRA_MOTION) ?: motion.motionState,
      deviceModel = extra(RecordingImuController.EXTRA_DEVICE_MODEL),
      osVersion = extra(RecordingImuController.EXTRA_OS_VERSION)
    )
    motion.applyExternal(extra(RecordingImuController.EXTRA_MOTION))
    lockedSsid = extra(RecordingImuController.EXTRA_LOCKED_SSID)
  }

  private val wifiTick = object : Runnable {
    override fun run() {
      lastPresence.set(DevicePresence.snapshot(this@RecordingImuService))
      sampleWifi()
      wifiHandler?.postDelayed(this, WIFI_INTERVAL_MS)
    }
  }

  private fun enqueueSample(sample: ImuSample) {
    val presence = lastPresence.get()
    val wifi = currentWifi.get()
    writer?.enqueue(
      sample.copy(
        ssid = sample.ssid ?: wifi.ssid,
        bssid = sample.bssid ?: wifi.bssid,
        rssi = sample.rssi ?: wifi.rssi?.toDouble(),
        frequency = sample.frequency ?: wifi.frequency,
        appState = presence.appState,
        lockScreen = presence.lockScreen,
        screenOn = presence.screenOn,
      )
    )
  }

  private fun sampleWifi() {
    if (!RecordingImuController.running) {
      return
    }
    val snapshot = ConnectedWifi.read(this)
    currentWifi.set(snapshot)
    lastWifi = snapshot
    val now = System.currentTimeMillis()
    val lock = lockedSsid
    wifiSsidMismatch = !lock.isNullOrEmpty() && snapshot.ssid != null && snapshot.ssid != lock
    enqueueSample(
      ImuSample(
        sensorType = "wifi",
        arrivalMs = now,
        sensorTimestampSec = now / 1000.0,
        ssid = snapshot.ssid,
        bssid = snapshot.bssid,
        rssi = snapshot.rssi?.toDouble(),
        frequency = snapshot.frequency,
      )
    )
    lastWifiIso = IsoUtc.format(now)
    RecordingImuController.lastSampleAtElapsed = SystemClock.elapsedRealtime()
    emitUi(now)
  }

  private fun emitUi(now: Long) {
    val wifi = lastWifi
    val presence = lastPresence.get()
    RecordingKeepaliveModule.emitLatest(
      lastAccelIso,
      lastGyroIso,
      lastBaroIso,
      motion.motionState,
      now,
      if (wifi?.connected == true) "CONNECTED" else "DISCONNECTED",
      wifi?.ssid,
      wifi?.bssid,
      wifi?.rssi,
      wifi?.frequency,
      lastWifiIso,
      wifiSsidMismatch,
      presence.appState,
      presence.lockScreen,
      presence.screenOn,
    )
  }

  private fun registerSensor(sensor: Sensor, handler: Handler) {
    val delays = intArrayOf(
      SensorManager.SENSOR_DELAY_FASTEST,
      SensorManager.SENSOR_DELAY_GAME,
      SensorManager.SENSOR_DELAY_UI,
      SensorManager.SENSOR_DELAY_NORMAL,
    )
    for (delay in delays) {
      try {
        val ok = sensorManager?.registerListener(
          this, sensor, delay, MAX_REPORT_LATENCY_US, handler
        ) == true
        if (ok) {
          return
        }
      } catch (_: SecurityException) {
        // HIGH_SAMPLING_RATE_SENSORS is required for FASTEST on Android 12+.
      } catch (_: Exception) {
        // Try a slower delay.
      }
    }
  }

  private fun stopInternal() {
    if (stopping) {
      return
    }
    stopping = true
    RecordingImuController.running = false
    try {
      wifiHandler?.removeCallbacks(wifiTick)
      wifiHandler = null
      wifiScheduled = false
      wifiHandlerThread?.quitSafely()
      wifiHandlerThread = null
      sensorManager?.unregisterListener(this)
      sensorThread?.quitSafely()
      sensorThread = null
      writer?.stop()
      writer = null
      RecordingImuController.activeWriter = null
      RecordingImuController.writerReady = false
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
      wakeLock = null
      try {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (_: Exception) {
        // Ignore.
      }
      stopSelf()
    } finally {
      RecordingImuController.countDownStop()
    }
  }

  companion object {
    const val ACCEL_INTERVAL_MS = 20L
    const val WIFI_INTERVAL_MS = 2000L
    const val GYRO_INTERVAL_MS = 20L
    const val BARO_INTERVAL_MS = 200L
    const val MAX_REPORT_LATENCY_US = 5_000_000

    fun start(context: android.content.Context, options: Map<String, String?>): Boolean {
      return RecordingImuController.start(context, options)
    }

    fun update(context: android.content.Context, options: Map<String, String?>) {
      RecordingImuController.update(context, options)
    }

    fun stop(context: android.content.Context): Boolean {
      return RecordingImuController.stop(context)
    }

    fun probe(context: android.content.Context): Map<String, Boolean> {
      return RecordingImuController.probe(context)
    }
  }
}
