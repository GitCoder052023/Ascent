import ExpoModulesCore

public class RecordingKeepaliveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RecordingKeepalive")

    Function("acquire") { () -> Bool in
      false
    }

    Function("release") { () -> Bool in
      false
    }

    Function("isHeld") { () -> Bool in
      false
    }

    Function("isIgnoringBatteryOptimizations") { () -> Bool in
      true
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") { () -> Bool in
      true
    }
  }
}
