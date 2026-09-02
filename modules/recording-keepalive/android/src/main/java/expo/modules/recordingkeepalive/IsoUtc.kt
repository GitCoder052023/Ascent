package expo.modules.recordingkeepalive

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal object IsoUtc {
  private val lock = Any()
  private val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  fun format(epochMs: Long): String {
    synchronized(lock) {
      return format.format(Date(epochMs))
    }
  }
}
