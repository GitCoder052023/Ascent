import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ActivityLabel, Floor, MotionState } from "./rawTypes";

export const KEY_ACTIVE_FLOOR = "@wifi_logger_active_floor";
export const KEY_ACTIVE_ACTIVITY = "@wifi_logger_active_activity";
export const KEY_SESSION_ID = "@wifi_logger_session_id";
export const KEY_MOTION_STATE = "@wifi_logger_motion_state";
export const KEY_LOCKED_SSID = "@wifi_logger_network";

export type CachedLabels = {
  sessionId: string | null;
  floor: Floor;
  activity: ActivityLabel | null;
  motionState: MotionState;
  recording: boolean;
  lockedSsid: string | null;
};

const cache: CachedLabels = {
  sessionId: null,
  floor: "FLOOR_1",
  activity: null,
  motionState: "STATIONARY",
  recording: false,
  lockedSsid: null,
};

function isFloor(value: string | null): value is Floor {
  return value === "GROUND_FLOOR" || value === "FLOOR_1" || value === "FLOOR_2";
}

function isActivity(value: string | null): value is ActivityLabel {
  return value === "GOING_UPSTAIRS" || value === "COMING_DOWNSTAIRS";
}

function isMotion(value: string | null): value is MotionState {
  return value === "WALKING" || value === "STATIONARY";
}

export function getCachedLabels(): CachedLabels {
  return cache;
}

export function setCachedRecording(recording: boolean) {
  cache.recording = recording;
}

export function setCachedSessionId(sessionId: string | null) {
  cache.sessionId = sessionId;
  if (sessionId) {
    void AsyncStorage.setItem(KEY_SESSION_ID, sessionId).catch(() => {});
  } else {
    void AsyncStorage.removeItem(KEY_SESSION_ID).catch(() => {});
  }
}

export function setCachedFloor(floor: Floor) {
  cache.floor = floor;
  void AsyncStorage.setItem(KEY_ACTIVE_FLOOR, floor).catch(() => {});
}

export function setCachedActivity(activity: ActivityLabel | null) {
  cache.activity = activity;
  if (activity) {
    void AsyncStorage.setItem(KEY_ACTIVE_ACTIVITY, activity).catch(() => {});
  } else {
    void AsyncStorage.removeItem(KEY_ACTIVE_ACTIVITY).catch(() => {});
  }
}

export function setCachedLockedSsid(ssid: string | null) {
  cache.lockedSsid = ssid;
  if (ssid) {
    void AsyncStorage.setItem(KEY_LOCKED_SSID, ssid).catch(() => {});
  } else {
    void AsyncStorage.removeItem(KEY_LOCKED_SSID).catch(() => {});
  }
}

export function setCachedMotionState(motionState: MotionState) {
  if (cache.motionState === motionState) {
    return;
  }
  cache.motionState = motionState;
  void AsyncStorage.setItem(KEY_MOTION_STATE, motionState).catch(() => {});
}

export async function hydrateLabelsFromStorage(): Promise<CachedLabels> {
  try {
    const [floor, activity, sessionId, motionState, lockedSsid] = await Promise.all([
      AsyncStorage.getItem(KEY_ACTIVE_FLOOR),
      AsyncStorage.getItem(KEY_ACTIVE_ACTIVITY),
      AsyncStorage.getItem(KEY_SESSION_ID),
      AsyncStorage.getItem(KEY_MOTION_STATE),
      AsyncStorage.getItem(KEY_LOCKED_SSID),
    ]);
    if (isFloor(floor)) {
      cache.floor = floor;
    }
    cache.activity = isActivity(activity) ? activity : null;
    cache.sessionId = sessionId;
    cache.lockedSsid = lockedSsid;
    if (isMotion(motionState)) {
      cache.motionState = motionState;
    }
  } catch {
    // Keep in-memory defaults.
  }
  return cache;
}

export async function readLabelsFromStorage(): Promise<CachedLabels> {
  const [floor, activity, sessionId, motionState, lockedSsid] = await Promise.all([
    AsyncStorage.getItem(KEY_ACTIVE_FLOOR),
    AsyncStorage.getItem(KEY_ACTIVE_ACTIVITY),
    AsyncStorage.getItem(KEY_SESSION_ID),
    AsyncStorage.getItem(KEY_MOTION_STATE),
    AsyncStorage.getItem(KEY_LOCKED_SSID),
  ]);
  return {
    sessionId,
    floor: isFloor(floor) ? floor : cache.floor,
    activity: isActivity(activity) ? activity : null,
    motionState: isMotion(motionState) ? motionState : cache.motionState,
    recording: cache.recording || Boolean(sessionId),
    lockedSsid: lockedSsid ?? cache.lockedSsid,
  };
}
