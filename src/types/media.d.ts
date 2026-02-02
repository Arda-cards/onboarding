// Extend MediaTrackCapabilities and MediaTrackConstraintSet for torch support
// (Chrome/Android support for flashlight control)
interface MediaTrackCapabilities {
  torch?: boolean;
}

interface MediaTrackConstraintSet {
  torch?: boolean;
}

interface MediaTrackSettings {
  torch?: boolean;
}
