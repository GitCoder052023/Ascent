import ExpoModulesCore

public class RecordingKeepaliveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RecordingKeepalive")

    Events("onLatest")

    Function("acquire") { () -> Bool in
      false
    }

    Function("release") { () -> Bool in
      false
    }

    Function("isHeld") { () -> Bool in
      false
    }

    Function("isRecording") { () -> Bool in
      false
    }

    Function("lastSampleAgeMs") { () -> Double in
      Double.greatestFiniteMagnitude
    }

    Function("isIgnoringBatteryOptimizations") { () -> Bool in
      true
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") { () -> Bool in
      true
    }

    Function("probeAvailability") { () -> [String: Bool] in
      [
        "accelerometerAvailable": false,
        "gyroscopeAvailable": false,
        "barometerAvailable": false,
      ]
    }

    AsyncFunction("startRecording") { (_ options: [String: String?]) -> Bool in
      false
    }

    Function("updateLabels") { (_ options: [String: String?]) -> Bool in
      false
    }

    AsyncFunction("stopRecording") { () -> Bool in
      false
    }
  }
}
