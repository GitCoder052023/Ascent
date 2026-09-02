package expo.modules.recordingkeepalive

internal object ImuSql {
  const val CREATE_RAW = """
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

  const val CREATE_MEASUREMENTS = """
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

  const val INSERT_RAW = """
      INSERT OR REPLACE INTO raw_observations (
        id, session_id, timestamp, arrival_timestamp, sensor_timestamp, timestamp_source, sensor_type,
        floor, activity, motion_state,
        accelerometer_x, accelerometer_y, accelerometer_z,
        gyroscope_x, gyroscope_y, gyroscope_z, barometer_pressure,
        ssid, bssid, signal_strength, signal_strength_unit, frequency, connection_type,
        platform, device_model, os_version, app_state, lock_screen, screen_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

  const val INSERT_MEASUREMENT = """
      INSERT OR REPLACE INTO measurements (
        id, timestamp, floor, ssid, bssid, signal_strength, signal_strength_unit,
        frequency, connection_type, platform, device_model, os_version,
        signal_strength_normalized, signal_strength_estimated_dbm, frequency_band,
        app_state, lock_screen, screen_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
}
