package expo.modules.recordingkeepalive

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement

internal object ImuSqliteBindings {
  fun bindRaw(
    statement: SQLiteStatement,
    sample: ImuSample,
    snap: RecordingLabels,
    id: String
  ) {
    val iso = IsoUtc.format(sample.arrivalMs)
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
    bindText(statement, 21, if (sample.rssi != null) "dBm" else null)
    if (sample.frequency != null) {
      statement.bindLong(22, sample.frequency.toLong())
    } else {
      statement.bindNull(22)
    }
    val hasWifi = sample.ssid != null || sample.bssid != null || sample.rssi != null || sample.sensorType == "wifi"
    bindText(statement, 23, if (hasWifi) "wifi" else null)
    statement.bindString(24, "android")
    bindText(statement, 25, snap.deviceModel)
    bindText(statement, 26, snap.osVersion)
    bindText(statement, 27, sample.appState)
    bindText(statement, 28, sample.lockScreen)
    bindText(statement, 29, sample.screenOn)
  }

  fun bindMeasurement(
    statement: SQLiteStatement,
    sample: ImuSample,
    snap: RecordingLabels,
    id: String
  ) {
    val iso = IsoUtc.format(sample.arrivalMs)
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

  fun migratePresenceColumns(database: SQLiteDatabase) {
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

  private fun bindText(statement: SQLiteStatement, index: Int, value: String?) {
    if (value == null) statement.bindNull(index) else statement.bindString(index, value)
  }

  private fun bindDouble(statement: SQLiteStatement, index: Int, value: Double?) {
    if (value == null) statement.bindNull(index) else statement.bindDouble(index, value)
  }
}
