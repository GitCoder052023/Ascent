package expo.modules.recordingkeepalive

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.os.Handler
import android.os.HandlerThread
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

internal data class ImuSample(
  val sensorType: String,
  val arrivalMs: Long,
  val sensorTimestampSec: Double,
  val x: Double?,
  val y: Double?,
  val z: Double?,
  val pressure: Double?,
)

internal data class RecordingLabels(
  val sessionId: String?,
  val floor: String?,
  val activity: String?,
  val motionState: String?,
  val deviceModel: String?,
  val osVersion: String?,
)

internal class ImuSqliteWriter(context: Context) {
  private val dbFile = File(File(context.filesDir, "SQLite"), DB_NAME)
  private val queue = ConcurrentLinkedQueue<ImuSample>()
  private val seq = AtomicLong(0)
  private val isoLock = Any()
  private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  @Volatile var labels = RecordingLabels(null, null, null, null, null, null)

  private var db: SQLiteDatabase? = null
  private var insert: SQLiteStatement? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  fun start() {
    if (thread != null) {
      return
    }
    dbFile.parentFile?.mkdirs()
    val opened = SQLiteDatabase.openDatabase(
      dbFile.path,
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
    )
    opened.enableWriteAheadLogging()
    opened.execSQL("PRAGMA busy_timeout = 8000")
    opened.execSQL(CREATE_RAW)
    insert = opened.compileStatement(INSERT_RAW)
    db = opened

    val writer = HandlerThread("ascent-imu-db").also { it.start() }
    thread = writer
    handler = Handler(writer.looper)
    handler?.postDelayed(flushRunnable, FLUSH_MS)
  }

  fun enqueue(sample: ImuSample) {
    queue.add(sample)
    if (queue.size >= FLUSH_SIZE) {
      handler?.post(flushRunnable)
    }
  }

  fun flushBlocking() {
    val lock = Object()
    var done = false
    val runner = handler ?: return
    runner.post {
      drainLocked()
      synchronized(lock) {
        done = true
        lock.notifyAll()
      }
    }
    synchronized(lock) {
      if (!done) {
        lock.wait(4000)
      }
    }
  }

  fun stop() {
    handler?.removeCallbacks(flushRunnable)
    flushBlocking()
    insert?.close()
    insert = null
    db?.close()
    db = null
    thread?.quitSafely()
    thread = null
    handler = null
  }

  fun nextId(arrivalMs: Long, sensorType: String): String {
    return "$arrivalMs-$sensorType-${seq.incrementAndGet()}"
  }

  private val flushRunnable = object : Runnable {
    override fun run() {
      drainLocked()
      handler?.postDelayed(this, FLUSH_MS)
    }
  }

  private fun drainLocked() {
    val statement = insert ?: return
    val database = db ?: return
    val batch = ArrayList<ImuSample>(FLUSH_SIZE)
    while (batch.size < FLUSH_SIZE) {
      val next = queue.poll() ?: break
      batch.add(next)
    }
    if (batch.isEmpty()) {
      return
    }
    val snap = labels
    database.beginTransaction()
    try {
      for (sample in batch) {
        bind(statement, sample, snap)
        statement.executeInsert()
        statement.clearBindings()
      }
      database.setTransactionSuccessful()
    } catch (_: Exception) {
      for (sample in batch.asReversed()) {
        queue.add(sample)
      }
    } finally {
      database.endTransaction()
    }
  }

  private fun bind(statement: SQLiteStatement, sample: ImuSample, snap: RecordingLabels) {
    val iso = synchronized(isoLock) { isoFormat.format(Date(sample.arrivalMs)) }
    statement.bindString(1, nextId(sample.arrivalMs, sample.sensorType))
    bindText(statement, 2, snap.sessionId)
    statement.bindString(3, iso)
    statement.bindString(4, iso)
    statement.bindDouble(5, sample.sensorTimestampSec)
    statement.bindString(6, "arrival")
    statement.bindString(7, sample.sensorType)
    bindText(statement, 8, snap.floor)
    bindText(statement, 9, snap.activity)
    bindText(statement, 10, snap.motionState)
    bindDouble(statement, 11, if (sample.sensorType == "accelerometer") sample.x else null)
    bindDouble(statement, 12, if (sample.sensorType == "accelerometer") sample.y else null)
    bindDouble(statement, 13, if (sample.sensorType == "accelerometer") sample.z else null)
    bindDouble(statement, 14, if (sample.sensorType == "gyroscope") sample.x else null)
    bindDouble(statement, 15, if (sample.sensorType == "gyroscope") sample.y else null)
    bindDouble(statement, 16, if (sample.sensorType == "gyroscope") sample.z else null)
    bindDouble(statement, 17, sample.pressure)
    statement.bindNull(18)
    statement.bindNull(19)
    statement.bindNull(20)
    statement.bindNull(21)
    statement.bindNull(22)
    statement.bindNull(23)
    statement.bindString(24, "android")
    bindText(statement, 25, snap.deviceModel)
    bindText(statement, 26, snap.osVersion)
  }

  private fun bindText(statement: SQLiteStatement, index: Int, value: String?) {
    if (value == null) statement.bindNull(index) else statement.bindString(index, value)
  }

  private fun bindDouble(statement: SQLiteStatement, index: Int, value: Double?) {
    if (value == null) statement.bindNull(index) else statement.bindDouble(index, value)
  }

  companion object {
    const val DB_NAME = "wifilogger_v2.db"
    private const val FLUSH_SIZE = 80
    private const val FLUSH_MS = 200L
    private const val CREATE_RAW = """
      CREATE TABLE IF NOT EXISTS raw_observations (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        arrival_timestamp TEXT NOT NULL,
        sensor_timestamp REAL,
        timestamp_source TEXT NOT NULL,
        sensor_type TEXT NOT NULL,
        floor TEXT,
        activity TEXT,
        motion_state TEXT,
        accelerometer_x REAL,
        accelerometer_y REAL,
        accelerometer_z REAL,
        gyroscope_x REAL,
        gyroscope_y REAL,
        gyroscope_z REAL,
        barometer_pressure REAL,
        ssid TEXT,
        bssid TEXT,
        signal_strength REAL,
        signal_strength_unit TEXT,
        frequency INTEGER,
        connection_type TEXT,
        platform TEXT,
        device_model TEXT,
        os_version TEXT
      )
    """
    private const val INSERT_RAW = """
      INSERT OR REPLACE INTO raw_observations (
        id, session_id, timestamp, arrival_timestamp, sensor_timestamp, timestamp_source, sensor_type,
        floor, activity, motion_state,
        accelerometer_x, accelerometer_y, accelerometer_z,
        gyroscope_x, gyroscope_y, gyroscope_z, barometer_pressure,
        ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
        platform, device_model, os_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
  }
}
