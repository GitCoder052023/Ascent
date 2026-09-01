package expo.modules.recordingkeepalive

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.sqrt

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

  private var lastAccelAt = 0L
  private var lastGyroAt = 0L
  private var lastBaroAt = 0L
  private var lastUiAt = 0L
  private var lastAccelIso: String? = null
  private var lastGyroIso: String? = null
  private var lastBaroIso: String? = null
  private var gravityEstimate = 1.0
  private var lastWalkAt = 0L
  private var motionState = "STATIONARY"
  private var wifiHandler: Handler? = null
  private var wifiScheduled = false
  private var lockedSsid: String? = null
  private var lastWifi: ConnectedWifiSnapshot? = null
  private var lastWifiIso: String? = null
  private var wifiSsidMismatch = false

  private val isoLock = Any()
  private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    enterForeground()
    try {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ascent:imu").apply {
        setReferenceCounted(false)
        acquire()
      }
      val sqlite = ImuSqliteWriter(this)
      if (!sqlite.start()) {
        signalStart(false)
        stopSelf()
        return
      }
      writer = sqlite
      activeWriter = sqlite
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
      wifiHandler = handler
      wifiScheduled = true
      handler.post(wifiTick)
      running = true
      signalStart(true)
    } catch (_: Exception) {
      running = false
      signalStart(false)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopInternal()
      return START_NOT_STICKY
    }
    enterForeground()
    applyLabels(intent)
    if (writer != null) {
      running = true
      signalStart(true)
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
        val magnitude = sqrt(x * x + y * y + z * z)
        gravityEstimate = 0.85 * gravityEstimate + 0.15 * magnitude
        if (kotlin.math.abs(magnitude - gravityEstimate) > 0.045) {
          lastWalkAt = now
        }
        motionState = if (now - lastWalkAt < 6000L) "WALKING" else "STATIONARY"
        writer?.let { w ->
          w.labels = w.labels.copy(motionState = motionState)
          w.enqueue(
            ImuSample("accelerometer", now, sensorTimestamp, x.toDouble(), y.toDouble(), z.toDouble(), null)
          )
        }
        lastAccelIso = iso(now)
        maybeEmit(now)
      }
      Sensor.TYPE_GYROSCOPE -> {
        if (now - lastGyroAt < GYRO_INTERVAL_MS) return
        lastGyroAt = now
        writer?.enqueue(
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
        lastGyroIso = iso(now)
        maybeEmit(now)
      }
      Sensor.TYPE_PRESSURE -> {
        if (now - lastBaroAt < BARO_INTERVAL_MS) return
        lastBaroAt = now
        val pressure = event.values[0].toDouble()
        if (!pressure.isFinite()) return
        writer?.enqueue(ImuSample("barometer", now, sensorTimestamp, null, null, null, pressure))
        lastBaroIso = iso(now)
        maybeEmit(now)
      }
    }
    lastSampleAtElapsed = SystemClock.elapsedRealtime()
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

  private fun iso(epochMs: Long): String {
    synchronized(isoLock) {
      return isoFormat.format(Date(epochMs))
    }
  }

  private fun applyLabels(intent: Intent?) {
    if (intent == null) {
      return
    }
    fun extra(key: String): String? = intent.getStringExtra(key)?.takeIf { it.isNotEmpty() }
    writer?.labels = RecordingLabels(
      sessionId = extra(EXTRA_SESSION_ID),
      floor = extra(EXTRA_FLOOR),
      activity = extra(EXTRA_ACTIVITY),
      motionState = extra(EXTRA_MOTION) ?: motionState,
      deviceModel = extra(EXTRA_DEVICE_MODEL),
      osVersion = extra(EXTRA_OS_VERSION)
    )
    extra(EXTRA_MOTION)?.let { motionState = it }
    lockedSsid = extra(EXTRA_LOCKED_SSID)
  }

  private val wifiTick = object : Runnable {
    override fun run() {
      sampleWifi()
      val delay = if (motionState == "WALKING") WIFI_WALKING_INTERVAL_MS else WIFI_STATIONARY_INTERVAL_MS
      wifiHandler?.postDelayed(this, delay)
    }
  }

  private fun sampleWifi() {
    if (!running) {
      return
    }
    val snapshot = ConnectedWifi.read(this)
    lastWifi = snapshot
    val now = System.currentTimeMillis()
    if (!snapshot.connected || snapshot.ssid == null) {
      wifiSsidMismatch = false
      emitUi(now)
      return
    }
    val lock = lockedSsid
    if (!lock.isNullOrEmpty() && snapshot.ssid != lock) {
      wifiSsidMismatch = true
      emitUi(now)
      return
    }
    wifiSsidMismatch = false
    writer?.enqueue(
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
    lastWifiIso = iso(now)
    lastSampleAtElapsed = SystemClock.elapsedRealtime()
    emitUi(now)
  }

  private fun emitUi(now: Long) {
    val wifi = lastWifi
    RecordingKeepaliveModule.emitLatest(
      lastAccelIso,
      lastGyroIso,
      lastBaroIso,
      motionState,
      now,
      if (wifi?.connected == true) "CONNECTED" else "DISCONNECTED",
      wifi?.ssid,
      wifi?.bssid,
      wifi?.rssi,
      wifi?.frequency,
      lastWifiIso,
      wifiSsidMismatch,
    )
  }

  private fun enterForeground() {
    val channelId = "ascent-imu"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        "Ascent IMU recording",
        NotificationManager.IMPORTANCE_LOW
      )
      channel.setShowBadge(false)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pending = if (launch != null) {
      val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    } else {
      null
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
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
    val locationOk = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
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
        startForeground(NOTIFICATION_ID, notification, types)
        started = true
        break
      } catch (_: Exception) {
        // Try the next declared FGS type. HEALTH|LOCATION together is rejected on
        // some OEMs even when LOCATION alone would be allowed.
      }
    }
    if (!started) {
      try {
        startForeground(NOTIFICATION_ID, notification)
      } catch (_: Exception) {
        // Keep sampling even if the notification type is rejected.
      }
    }
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
        val ok = sensorManager?.registerListener(this, sensor, delay, 0, handler) == true
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
    running = false
    wifiHandler?.removeCallbacks(wifiTick)
    wifiHandler = null
    wifiScheduled = false
    sensorManager?.unregisterListener(this)
    sensorThread?.quitSafely()
    sensorThread = null
    writer?.stop()
    writer = null
    activeWriter = null
    writerReady = false
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
  }

  companion object {
    const val ACTION_STOP = "expo.modules.recordingkeepalive.STOP"
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_FLOOR = "floor"
    const val EXTRA_ACTIVITY = "activity"
    const val EXTRA_MOTION = "motionState"
    const val EXTRA_DEVICE_MODEL = "deviceModel"
    const val EXTRA_OS_VERSION = "osVersion"
    const val EXTRA_LOCKED_SSID = "lockedSsid"
    const val ACCEL_INTERVAL_MS = 20L
    const val WIFI_WALKING_INTERVAL_MS = 3000L
    const val WIFI_STATIONARY_INTERVAL_MS = 30000L
    const val GYRO_INTERVAL_MS = 20L
    const val BARO_INTERVAL_MS = 200L
    private const val NOTIFICATION_ID = 481757

    @Volatile var running = false
      private set
    @Volatile var writerReady = false
      private set
    @Volatile var lastSampleAtElapsed = 0L
    @Volatile internal var activeWriter: ImuSqliteWriter? = null
    private val startLatch = AtomicReference<CountDownLatch?>(null)

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
      if (Looper.myLooper() == Looper.getMainLooper()) {
        return true
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

    fun stop(context: Context) {
      val intent = Intent(context, RecordingImuService::class.java).setAction(ACTION_STOP)
      context.startService(intent)
    }

    fun probe(context: Context): Map<String, Boolean> {
      val sm = context.getSystemService(SENSOR_SERVICE) as SensorManager
      return mapOf(
        "accelerometerAvailable" to (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null),
        "gyroscopeAvailable" to (sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null),
        "barometerAvailable" to (sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null),
      )
    }

    private fun signalStart(ok: Boolean) {
      writerReady = ok && activeWriter != null
      startLatch.getAndSet(null)?.countDown()
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
}
