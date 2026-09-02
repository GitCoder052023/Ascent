package expo.modules.recordingkeepalive

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.os.Handler
import android.os.HandlerThread
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

internal class ImuSqliteWriter(context: Context) {
  private val dbFile = File(File(context.filesDir, "SQLite"), DB_NAME)
  private val queue = ConcurrentLinkedQueue<ImuSample>()
  private val seq = AtomicLong(0)
  private val totalRawCount = AtomicLong(0)
  private val totalWifiCount = AtomicLong(0)

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
      opened.execSQL(ImuSql.CREATE_RAW)
      opened.execSQL(ImuSql.CREATE_MEASUREMENTS)
      ImuSqliteBindings.migratePresenceColumns(opened)
      insertRaw = opened.compileStatement(ImuSql.INSERT_RAW)
      insertMeasurement = opened.compileStatement(ImuSql.INSERT_MEASUREMENT)
      val initialRaw = try {
        opened.compileStatement("SELECT COUNT(*) FROM raw_observations").use { it.simpleQueryForLong() }
      } catch (_: Exception) {
        0L
      }
      val initialWifi = try {
        opened.compileStatement("SELECT COUNT(*) FROM measurements").use { it.simpleQueryForLong() }
      } catch (_: Exception) {
        0L
      }
      totalRawCount.set(initialRaw)
      totalWifiCount.set(initialWifi)
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
    totalRawCount.incrementAndGet()
    if (sample.sensorType == "wifi") {
      totalWifiCount.incrementAndGet()
    }
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

  fun observationCount(): Long = totalRawCount.get()

  fun wifiCount(): Long = totalWifiCount.get()

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
        ImuSqliteBindings.bindRaw(rawStatement, sample, snap, id)
        rawStatement.executeInsert()
        rawStatement.clearBindings()
        if (sample.sensorType == "wifi") {
          insertMeasurement?.let { statement ->
            ImuSqliteBindings.bindMeasurement(statement, sample, snap, id)
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

  companion object {
    const val DB_NAME = "wifilogger_v2.db"
    private const val FLUSH_SIZE = 80
    private const val FLUSH_MS = 200L
  }
}
