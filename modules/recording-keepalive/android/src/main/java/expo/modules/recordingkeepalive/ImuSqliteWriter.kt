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
  private var insertRaw: SQLiteStatement? = null
  private var insertMeasurement: SQLiteStatement? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  fun start(): Boolean {
    if (thread != null) {
      return db != null
    }
    return try {
      dbFile.parentFile?.mkdirs()
      val opened = SQLiteDatabase.openDatabase(
        dbFile.path,
        null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
      )
      opened.enableWriteAheadLogging()
      opened.execSQL("PRAGMA busy_timeout = 8000")
      opened.execSQL(CREATE_RAW)
      opened.execSQL(CREATE_MEASUREMENTS)
      migratePresenceColumns(opened)
      insertRaw = opened.compileStatement(INSERT_RAW)
      insertMeasurement = opened.compileStatement(INSERT_MEASUREMENT)
      db = opened

      val writer = HandlerThread("ascent-imu-db").also { it.start() }
      thread = writer
      handler = Handler(writer.looper)
      handler?.postDelayed(flushRunnable, FLUSH_MS)
      true
    } catch (_: Exception) {
      false
    }
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

  fun observationCount(): Long {
    val database = db ?: return -1L
    val flushed = try {
      database.rawQuery("SELECT COUNT(*) FROM raw_observations", null).use { cursor ->
        if (cursor.moveToFirst()) cursor.getLong(0) else 0L
      }
    } catch (_: Exception) {
      return -1L
    }
    return flushed + queue.size
  }

  fun checkpoint(mode: String = "PASSIVE") {
    try {
      db?.rawQuery("PRAGMA wal_checkpoint($mode)", null)?.close()
    } catch (_: Exception) {
      // Keep writing even if the JS connection is holding a page.
    }
  }

  fun stop() {
    handler?.removeCallbacks(flushRunnable)
    flushBlocking()
    checkpoint("TRUNCATE")
    insertRaw?.close()
    insertRaw = null
    insertMeasurement?.close()
    insertMeasurement = null
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
    val rawStatement = insertRaw ?: return
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
        val id = nextId(sample.arrivalMs, sample.sensorType)
        bindRaw(rawStatement, sample, snap, id)
        rawStatement.executeInsert()
        rawStatement.clearBindings()
        if (sample.sensorType == "wifi") {
          insertMeasurement?.let { statement ->
            bindMeasurement(statement, sample, snap, id)
            statement.executeInsert()
            statement.clearBindings()
          }
        }
      }
      database.setTransactionSuccessful()
    } catch (_: Exception) {
      for (sample in batch.asReversed()) {
        queue.add(sample)
      }
    } finally {
      try {
        database.endTransaction()
      } catch (_: Exception) {
        // Next flush retries the same batch.
      }
      checkpoint("PASSIVE")
    }
  }

  private fun bindRaw(
    statement: SQLiteStatement,
    sample: ImuSample,
    snap: RecordingLabels,
    id: String
  ) {
    val iso = synchronized(isoLock) { isoFormat.format(Date(sample.arrivalMs)) }
    statement.bindString(1, id)
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
    bindText(statement, 18, sample.ssid)
    bindText(statement, 19, sample.bssid)
    bindDouble(statement, 20, sample.rssi)
    bindText(statement, 21, if (sample.sensorType == "wifi" && sample.rssi != null) "dBm" else null)
    if (sample.frequency != null) {
      statement.bindLong(22, sample.frequency.toLong())
    } else {
      statement.bindNull(22)
    }
    bindText(statement, 23, if (sample.sensorType == "wifi") "wifi" else null)
    statement.bindString(24, "android")
    bindText(statement, 25, snap.deviceModel)
    bindText(statement, 26, snap.osVersion)
    bindText(statement, 27, sample.appState)
    bindText(statement, 28, sample.lockScreen)
    bindText(statement, 29, sample.screenOn)
  }

  private fun bindMeasurement(
    statement: SQLiteStatement,
    sample: ImuSample,
    snap: RecordingLabels,
    id: String
  ) {
    val iso = synchronized(isoLock) { isoFormat.format(Date(sample.arrivalMs)) }
    val freq = sample.frequency
    val rssi = sample.rssi?.toInt()
    val band = ConnectedWifi.frequencyBand(freq)
    val score = ConnectedWifi.normalizedScore(rssi, freq)
    statement.bindString(1, id)
    statement.bindString(2, iso)
    bindText(statement, 3, snap.floor ?: "FLOOR_1")
    bindText(statement, 4, sample.ssid)
    bindText(statement, 5, sample.bssid)
    bindDouble(statement, 6, sample.rssi)
    bindText(statement, 7, if (sample.rssi != null) "dBm" else null)
    if (freq != null) statement.bindLong(8, freq.toLong()) else statement.bindNull(8)
    statement.bindString(9, "wifi")
    statement.bindString(10, "android")
    bindText(statement, 11, snap.deviceModel)
    bindText(statement, 12, snap.osVersion)
    bindDouble(statement, 13, score)
    bindDouble(statement, 14, sample.rssi)
    bindText(statement, 15, band)
    bindText(statement, 16, sample.appState)
    bindText(statement, 17, sample.lockScreen)
    bindText(statement, 18, sample.screenOn)
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
        os_version TEXT,
        app_state TEXT,
        lock_screen TEXT,
        screen_on TEXT
      )
    """
    private const val CREATE_MEASUREMENTS = """
      CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        floor TEXT NOT NULL,
        ssid TEXT,
        bssid TEXT,
        signal_strength REAL,
        signal_strength_unit TEXT,
        frequency INTEGER,
        connection_type TEXT,
        platform TEXT,
        device_model TEXT,
        os_version TEXT,
        signal_strength_normalized REAL,
        signal_strength_estimated_dbm REAL,
        frequency_band TEXT,
        app_state TEXT,
        lock_screen TEXT,
        screen_on TEXT
      )
    """
    private const val INSERT_RAW = """
      INSERT OR REPLACE INTO raw_observations (
        id, session_id, timestamp, arrival_timestamp, sensor_timestamp, timestamp_source, sensor_type,
        floor, activity, motion_state,
        accelerometer_x, accelerometer_y, accelerometer_z,
        gyroscope_x, gyroscope_y, gyroscope_z, barometer_pressure,
        ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
        platform, device_model, os_version, app_state, lock_screen, screen_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    private const val INSERT_MEASUREMENT = """
      INSERT OR REPLACE INTO measurements (
        id, timestamp, floor, ssid, bssid, signal_strength, signal_strength_unit,
        frequency, connection_type, platform, device_model, os_version,
        signal_strength_normalized, signal_strength_estimated_dbm, frequency_band,
        app_state, lock_screen, screen_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    private fun migratePresenceColumns(database: SQLiteDatabase) {
      val statements = arrayOf(
        "ALTER TABLE raw_observations ADD COLUMN app_state TEXT",
        "ALTER TABLE raw_observations ADD COLUMN lock_screen TEXT",
        "ALTER TABLE raw_observations ADD COLUMN screen_on TEXT",
        "ALTER TABLE measurements ADD COLUMN app_state TEXT",
        "ALTER TABLE measurements ADD COLUMN lock_screen TEXT",
        "ALTER TABLE measurements ADD COLUMN screen_on TEXT",
      )
      for (sql in statements) {
        try {
          database.execSQL(sql)
        } catch (_: Exception) {
          // Column already exists on upgraded databases.
        }
      }
    }
  }
}
