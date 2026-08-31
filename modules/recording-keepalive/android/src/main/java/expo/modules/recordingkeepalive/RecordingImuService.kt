package expo.modules.recordingkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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

  private val isoLock = Any()
  private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    enterForeground()
    val pm = getSystemService(POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ascent:imu").apply {
      setReferenceCounted(false)
      acquire()
    }
    writer = ImuSqliteWriter(this).also { it.start() }
    sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
    accel = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    gyro = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    baro = sensorManager?.getDefaultSensor(Sensor.TYPE_PRESSURE)
    val thread = HandlerThread("ascent-imu-sensors").also { it.start() }
    sensorThread = thread
    val handler = Handler(thread.looper)
    val delay = SensorManager.SENSOR_DELAY_FASTEST
    accel?.let { sensorManager?.registerListener(this, it, delay, 0, handler) }
    gyro?.let { sensorManager?.registerListener(this, it, delay, 0, handler) }
    baro?.let { sensorManager?.registerListener(this, it, delay, 0, handler) }
    running = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopInternal()
      return START_NOT_STICKY
    }
    enterForeground()
    applyLabels(intent)
    running = true
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
      RecordingKeepaliveModule.emitLatest(
        lastAccelIso,
        lastGyroIso,
        lastBaroIso,
        motionState,
        now
      )
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
      .setContentText("Native accelerometer, gyroscope, and barometer are recording.")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pending)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, 0)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Exception) {
      try {
        startForeground(NOTIFICATION_ID, notification)
      } catch (_: Exception) {
        // Location FGS + wake lock still keep the process; keep sampling anyway.
      }
    }
  }

  private fun stopInternal() {
    if (stopping) {
      return
    }
    stopping = true
    running = false
    sensorManager?.unregisterListener(this)
    sensorThread?.quitSafely()
    sensorThread = null
    writer?.stop()
    writer = null
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
    const val ACCEL_INTERVAL_MS = 20L
    const val GYRO_INTERVAL_MS = 20L
    const val BARO_INTERVAL_MS = 200L
    private const val NOTIFICATION_ID = 481757

    @Volatile var running = false
      private set
    @Volatile var lastSampleAtElapsed = 0L

    fun start(context: Context, extras: Intent.() -> Unit) {
      val intent = Intent(context, RecordingImuService::class.java).apply(extras)
      if (running) {
        context.startService(intent)
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun update(context: Context, extras: Intent.() -> Unit) {
      if (!running) {
        return
      }
      context.startService(Intent(context, RecordingImuService::class.java).apply(extras))
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
  }
}
