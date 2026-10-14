import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  axisLabel,
  deriveCalibration,
  type CalibrationProfile,
  type OrientationAxis,
  type OrientationPoint,
  unwrapAngle,
} from "./repValidation";

type PermissionState = "idle" | "requesting" | "granted" | "denied" | "unsupported";
type DetectorPhase = "waiting" | "moving" | "blocked";
type MovementClass = "tam" | "yarım" | "gürültü" | "geçersiz";
type FeedbackKind = "rep" | "set";

interface ExerciseOption {
  name: string;
  placement: string;
}

interface MotionValues {
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
}

interface OrientationValues {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

interface UnwrappedOrientation {
  alpha: number;
  beta: number;
  gamma: number;
}

interface AxisTracker {
  raw: number | null;
  unwrapped: number;
  smoothed: number;
}

interface MovementEvent {
  id: number;
  timestamp: string;
  className: MovementClass;
  accepted: boolean;
  angleDeg: number;
  durationMs: number;
  reason: string;
  validTotal: number;
  setNumber: number;
}

interface SessionStats {
  valid: number;
  fullCandidates: number;
  halfCandidates: number;
  rejected: number;
}

interface FeedbackSignal {
  id: number;
  kind: FeedbackKind;
  title: string;
  detail: string;
}

interface DetectorState {
  phase: DetectorPhase;
  baseline: number;
  startAt: number;
  peakDeg: number;
  lastAngle: number;
  lastMovedAt: number;
}

interface CsvRecord {
  timestamp: string;
  elapsed_ms: number | "";
  exercise: string;
  placement: string;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  record_type: "sample" | "movement" | "calibration";
  rep_candidate_id: number | "";
  classification: MovementClass | "";
  accepted: "yes" | "no" | "";
  reason: string;
  movement_angle_deg: number | "";
  movement_duration_ms: number | "";
  selected_axis: OrientationAxis | "";
  calibration_span_deg: number | "";
  half_threshold_deg: number | "";
  full_threshold_deg: number | "";
  set_number: number | "";
  valid_reps: number | "";
  half_candidates: number | "";
}

const EXERCISES: ExerciseOption[] = [
  { name: "Biceps Curl", placement: "Ön kol / bilek" },
  { name: "Squat", placement: "Üst bacak / cep" },
  { name: "Push-up", placement: "Üst kol / kol bandı" },
  { name: "Shoulder Press", placement: "Ön kol / bilek" },
  { name: "Lateral Raise", placement: "Üst kol / kol bandı" },
];

const PLACEMENTS = ["Ön kol / bilek", "Üst kol / kol bandı", "Üst bacak / cep", "Bel / kemer"];
const CALIBRATION_MS = 8000;
const CSV_COLUMNS: (keyof CsvRecord)[] = [
  "timestamp",
  "elapsed_ms",
  "exercise",
  "placement",
  "ax",
  "ay",
  "az",
  "gx",
  "gy",
  "gz",
  "alpha",
  "beta",
  "gamma",
  "record_type",
  "rep_candidate_id",
  "classification",
  "accepted",
  "reason",
  "movement_angle_deg",
  "movement_duration_ms",
  "selected_axis",
  "calibration_span_deg",
  "half_threshold_deg",
  "full_threshold_deg",
  "set_number",
  "valid_reps",
  "half_candidates",
];

const EMPTY_MOTION: MotionValues = { ax: null, ay: null, az: null, gx: null, gy: null, gz: null };
const EMPTY_ORIENTATION: OrientationValues = { alpha: null, beta: null, gamma: null };
const EMPTY_STATS: SessionStats = { valid: 0, fullCandidates: 0, halfCandidates: 0, rejected: 0 };

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function displayNumber(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} sn`;
}

function formatSessionDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function csvValue(value: CsvRecord[keyof CsvRecord]): string {
  if (value === null || value === "") return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function emptyCsvRecord(exercise: string, placement: string): CsvRecord {
  return {
    timestamp: new Date().toISOString(),
    elapsed_ms: "",
    exercise,
    placement,
    ax: null,
    ay: null,
    az: null,
    gx: null,
    gy: null,
    gz: null,
    alpha: null,
    beta: null,
    gamma: null,
    record_type: "sample",
    rep_candidate_id: "",
    classification: "",
    accepted: "",
    reason: "",
    movement_angle_deg: "",
    movement_duration_ms: "",
    selected_axis: "",
    calibration_span_deg: "",
    half_threshold_deg: "",
    full_threshold_deg: "",
    set_number: "",
    valid_reps: "",
    half_candidates: "",
  };
}

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.5, max - min);
    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 100;
        const y = 37 - ((value - min) / span) * 32;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  return (
    <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="Son ivme örnekleri grafiği">
      <path d="M0 21H100" className="sparkline-grid" />
      {points && <polyline points={points} className="sparkline-line" />}
    </svg>
  );
}

export default function App() {
  const vibrationSupported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [permissionMessage, setPermissionMessage] = useState("Sensörleri kullanmak için izin verin.");
  const [exercise, setExercise] = useState(EXERCISES[0].name);
  const [placement, setPlacement] = useState(EXERCISES[0].placement);
  const [recording, setRecording] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveMotion, setLiveMotion] = useState<MotionValues>(EMPTY_MOTION);
  const [liveOrientation, setLiveOrientation] = useState<OrientationValues>(EMPTY_ORIENTATION);
  const [sparkValues, setSparkValues] = useState<number[]>([]);
  const [signalFresh, setSignalFresh] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(null);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationSeconds, setCalibrationSeconds] = useState(0);
  const [calibrationMessage, setCalibrationMessage] = useState(
    "Telefonu ön kolunuza sabitleyin. Başlatınca 1 sn kolu düz tutup 3 rahat tekrar yapın.",
  );
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [history, setHistory] = useState<MovementEvent[]>([]);
  const [statusMessage, setStatusMessage] = useState("Hazır");
  const [vibrationEnabled, setVibrationEnabled] = useState(vibrationSupported);
  const [feedback, setFeedback] = useState<FeedbackSignal | null>(null);
  const [focusMode, setFocusMode] = useState(false);

  const exerciseRef = useRef(exercise);
  const placementRef = useRef(placement);
  const recordingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const calibrationRef = useRef<CalibrationProfile | null>(null);
  const calibrationRunningRef = useRef(false);
  const calibrationSamplesRef = useRef<OrientationPoint[]>([]);
  const calibrationTimeoutRef = useRef<number | null>(null);
  const calibrationIntervalRef = useRef<number | null>(null);
  const latestMotionRef = useRef<MotionValues>({ ...EMPTY_MOTION });
  const latestOrientationRef = useRef<OrientationValues>({ ...EMPTY_ORIENTATION });
  const latestSmoothedRef = useRef<UnwrappedOrientation | null>(null);
  const axisTrackersRef = useRef<Record<OrientationAxis, AxisTracker>>({
    alpha: { raw: null, unwrapped: 0, smoothed: 0 },
    beta: { raw: null, unwrapped: 0, smoothed: 0 },
    gamma: { raw: null, unwrapped: 0, smoothed: 0 },
  });
  const listenersAttachedRef = useRef(false);
  const lastMotionAtRef = useRef(0);
  const lastOrientationAtRef = useRef(0);
  const lastUiAtRef = useRef(0);
  const lastSparkAtRef = useRef(0);
  const lastCounterUiAtRef = useRef(0);
  const csvRecordsRef = useRef<CsvRecord[]>([]);
  const sampleCountRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const statsRef = useRef<SessionStats>({ ...EMPTY_STATS });
  const candidateIdRef = useRef(0);
  const detectorRef = useRef<DetectorState | null>(null);
  const processAngleRef = useRef<(orientation: UnwrappedOrientation, now: number) => void>(() => undefined);
  const vibrationEnabledRef = useRef(vibrationSupported);
  const feedbackIdRef = useRef(0);
  const feedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    exerciseRef.current = exercise;
    placementRef.current = placement;
  }, [exercise, placement]);

  useEffect(() => {
    calibrationRef.current = calibration;
  }, [calibration]);

  useEffect(() => {
    vibrationEnabledRef.current = vibrationEnabled;
  }, [vibrationEnabled]);

  useEffect(() => {
    document.body.classList.toggle("focus-mode-open", focusMode);
    return () => document.body.classList.remove("focus-mode-open");
  }, [focusMode]);

  const publishLiveValues = useCallback(() => {
    const now = performance.now();
    if (now - lastUiAtRef.current < 100) return;
    lastUiAtRef.current = now;
    setLiveMotion({ ...latestMotionRef.current });
    setLiveOrientation({ ...latestOrientationRef.current });
  }, []);

  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity ?? event.acceleration;
      const rotation = event.rotationRate;
      latestMotionRef.current = {
        ax: nullableNumber(acceleration?.x),
        ay: nullableNumber(acceleration?.y),
        az: nullableNumber(acceleration?.z),
        gx: nullableNumber(rotation?.alpha),
        gy: nullableNumber(rotation?.beta),
        gz: nullableNumber(rotation?.gamma),
      };
      lastMotionAtRef.current = performance.now();
      publishLiveValues();

      if (latestMotionRef.current.ax !== null && performance.now() - lastSparkAtRef.current >= 100) {
        lastSparkAtRef.current = performance.now();
        setSparkValues((previous) => [...previous.slice(-79), latestMotionRef.current.ax as number]);
      }

      if (!recordingRef.current) return;

      const elapsed = Math.max(0, Math.round(performance.now() - recordingStartedAtRef.current));
      const motion = latestMotionRef.current;
      const orientation = latestOrientationRef.current;
      csvRecordsRef.current.push({
        ...emptyCsvRecord(exerciseRef.current, placementRef.current),
        timestamp: new Date().toISOString(),
        elapsed_ms: elapsed,
        ax: motion.ax,
        ay: motion.ay,
        az: motion.az,
        gx: motion.gx,
        gy: motion.gy,
        gz: motion.gz,
        alpha: orientation.alpha,
        beta: orientation.beta,
        gamma: orientation.gamma,
        record_type: "sample",
      });
      sampleCountRef.current += 1;
      if (performance.now() - lastCounterUiAtRef.current > 200) {
        lastCounterUiAtRef.current = performance.now();
        setSampleCount(sampleCountRef.current);
      }
    },
    [publishLiveValues],
  );

  const handleOrientation = useCallback(
    (event: DeviceOrientationEvent) => {
      const raw: OrientationValues = {
        alpha: nullableNumber(event.alpha),
        beta: nullableNumber(event.beta),
        gamma: nullableNumber(event.gamma),
      };
      latestOrientationRef.current = raw;
      const next = {} as UnwrappedOrientation;
      let complete = true;

      (["alpha", "beta", "gamma"] as OrientationAxis[]).forEach((axis) => {
        const value = raw[axis];
        const tracker = axisTrackersRef.current[axis];
        if (value === null) {
          complete = false;
          next[axis] = tracker.smoothed;
          return;
        }
        const unwrapped =
          tracker.raw === null ? value : unwrapAngle(value, tracker.raw, tracker.unwrapped);
        const smoothed = tracker.raw === null ? unwrapped : tracker.smoothed + 0.2 * (unwrapped - tracker.smoothed);
        axisTrackersRef.current[axis] = { raw: value, unwrapped, smoothed };
        next[axis] = smoothed;
      });

      lastOrientationAtRef.current = performance.now();
      publishLiveValues();
      if (!complete) return;
      latestSmoothedRef.current = next;

      if (calibrationRunningRef.current) {
        calibrationSamplesRef.current.push({ t: performance.now(), ...next });
        return;
      }
      processAngleRef.current(next, performance.now());
    },
    [publishLiveValues],
  );

  const detachSensors = useCallback(() => {
    if (!listenersAttachedRef.current) return;
    window.removeEventListener("devicemotion", handleMotion);
    window.removeEventListener("deviceorientation", handleOrientation);
    listenersAttachedRef.current = false;
  }, [handleMotion, handleOrientation]);

  const attachSensors = useCallback(() => {
    if (listenersAttachedRef.current) return;
    window.addEventListener("devicemotion", handleMotion);
    window.addEventListener("deviceorientation", handleOrientation);
    listenersAttachedRef.current = true;
  }, [handleMotion, handleOrientation]);

  useEffect(() => {
    return () => {
      detachSensors();
      if (calibrationTimeoutRef.current !== null) window.clearTimeout(calibrationTimeoutRef.current);
      if (calibrationIntervalRef.current !== null) window.clearInterval(calibrationIntervalRef.current);
      if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current);
    };
  }, [detachSensors]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = performance.now();
      const motionFresh = lastMotionAtRef.current > 0 && now - lastMotionAtRef.current < 1800;
      const orientationFresh = lastOrientationAtRef.current > 0 && now - lastOrientationAtRef.current < 1800;
      const streamFresh = motionFresh && (exerciseRef.current !== "Biceps Curl" || orientationFresh);
      setSignalFresh(streamFresh);
      if (recordingRef.current) {
        const elapsed = Math.max(0, Math.round(now - recordingStartedAtRef.current));
        elapsedRef.current = elapsed;
        setElapsedMs(elapsed);
        setSampleCount(sampleCountRef.current);
        if (!streamFresh) {
          const detector = detectorRef.current;
          if (exerciseRef.current === "Biceps Curl" && detector?.phase === "moving") {
            recordMovement(
              "geçersiz",
              detector.peakDeg,
              now - detector.startAt,
              "Sensör akışı kesildi veya ekran kilitlendi; yarım kalan aday reddedildi.",
              false,
            );
            detector.phase = "blocked";
          }
          setStatusMessage("Sensör akışı kesildi. Safari’yi önde ve ekranı açık tutun.");
        }
      }
    }, 400);
    return () => window.clearInterval(interval);
  }, []);

  async function requestSensorPermission() {
    setPermission("requesting");
    setPermissionMessage("iPhone sensör izinleri bekleniyor…");
    try {
      if (!("DeviceMotionEvent" in window) || !("DeviceOrientationEvent" in window)) {
        setPermission("unsupported");
        setPermissionMessage("Bu tarayıcı hareket/yön sensörlerini sunmuyor.");
        return;
      }

      type PermissionAware = { requestPermission?: () => Promise<"granted" | "denied"> };
      const motionConstructor = (window as unknown as { DeviceMotionEvent: PermissionAware }).DeviceMotionEvent;
      const orientationConstructor = (window as unknown as { DeviceOrientationEvent: PermissionAware })
        .DeviceOrientationEvent;
      const requests: Promise<"granted" | "denied">[] = [];
      if (typeof motionConstructor.requestPermission === "function") {
        requests.push(motionConstructor.requestPermission());
      }
      if (typeof orientationConstructor.requestPermission === "function") {
        requests.push(orientationConstructor.requestPermission());
      }
      const results = requests.length ? await Promise.all(requests) : ["granted" as const];
      if (results.some((result) => result !== "granted")) {
        setPermission("denied");
        setPermissionMessage("Sensör izni verilmedi. Safari site ayarlarından izni açıp yeniden deneyin.");
        return;
      }
      attachSensors();
      setPermission("granted");
      setPermissionMessage("Sensör izni açık. Telefonu seçilen bölgeye sıkıca sabitleyin.");
    } catch (error) {
      setPermission("denied");
      setPermissionMessage(
        error instanceof Error ? `İzin alınamadı: ${error.message}` : "Sensör izni alınamadı.",
      );
    }
  }

  function signalAcceptedMovement(validTotal: number) {
    const completedSet = validTotal <= 30 && validTotal % 10 === 0;
    feedbackIdRef.current += 1;
    setFeedback({
      id: feedbackIdRef.current,
      kind: completedSet ? "set" : "rep",
      title: completedSet ? `${validTotal / 10}. set tamamlandı` : `${validTotal}. tekrar kabul edildi`,
      detail: completedSet ? "10 geçerli tekrar tamamlandı" : "Tam hareket geçerli sayıldı",
    });

    if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = window.setTimeout(() => setFeedback(null), completedSet ? 1800 : 1100);

    if (vibrationSupported && vibrationEnabledRef.current) {
      navigator.vibrate(completedSet ? [140, 80, 140] : 80);
    }
  }

  function toggleVibration() {
    if (!vibrationSupported) return;
    setVibrationEnabled((enabled) => {
      const next = !enabled;
      if (!next) navigator.vibrate(0);
      return next;
    });
  }

  function recordMovement(
    className: MovementClass,
    angleDeg: number,
    durationMs: number,
    reason: string,
    accepted: boolean,
  ) {
    candidateIdRef.current += 1;
    const previous = statsRef.current;
    const next: SessionStats = {
      valid: previous.valid + (accepted ? 1 : 0),
      fullCandidates: previous.fullCandidates + (className === "tam" ? 1 : 0),
      halfCandidates: previous.halfCandidates + (className === "yarım" ? 1 : 0),
      rejected: previous.rejected + (!accepted ? 1 : 0),
    };
    statsRef.current = next;
    setStats(next);
    const setNumber = accepted ? Math.min(3, Math.floor((next.valid - 1) / 10) + 1) : Math.min(3, Math.floor(next.valid / 10) + 1);
    const movement: MovementEvent = {
      id: candidateIdRef.current,
      timestamp: new Date().toISOString(),
      className,
      accepted,
      angleDeg,
      durationMs,
      reason,
      validTotal: next.valid,
      setNumber,
    };
    setHistory((previousHistory) => [movement, ...previousHistory].slice(0, 40));
    setStatusMessage(accepted ? `Tam tekrar kabul edildi · ${next.valid}. geçerli tekrar` : reason);
    if (accepted) signalAcceptedMovement(next.valid);

    const profile = calibrationRef.current;
    const row = emptyCsvRecord(exerciseRef.current, placementRef.current);
    csvRecordsRef.current.push({
      ...row,
      timestamp: movement.timestamp,
      elapsed_ms: Math.round(performance.now() - recordingStartedAtRef.current),
      record_type: "movement",
      rep_candidate_id: movement.id,
      classification: className,
      accepted: accepted ? "yes" : "no",
      reason,
      movement_angle_deg: Number(angleDeg.toFixed(2)),
      movement_duration_ms: Math.round(durationMs),
      selected_axis: profile?.axis ?? "",
      calibration_span_deg: profile ? Number(profile.spanDeg.toFixed(2)) : "",
      half_threshold_deg: profile ? Number(profile.halfThresholdDeg.toFixed(2)) : "",
      full_threshold_deg: profile ? Number(profile.fullThresholdDeg.toFixed(2)) : "",
      set_number: setNumber,
      valid_reps: next.valid,
      half_candidates: next.halfCandidates,
    });
  }

  processAngleRef.current = (orientation, now) => {
    if (!recordingRef.current || exerciseRef.current !== "Biceps Curl") return;
    const profile = calibrationRef.current;
    if (!profile) return;
    const angle = orientation[profile.axis];
    const detector = detectorRef.current;
    if (!detector) return;
    const signedProgress = (angle - detector.baseline) * profile.direction;
    const progress = Math.max(0, signedProgress);
    const changed = Math.abs(angle - detector.lastAngle) >= Math.max(0.3, profile.noiseFloorDeg * 0.5);

    if (detector.phase === "waiting") {
      if (progress <= profile.returnDeg) {
        detector.baseline += (angle - detector.baseline) * 0.01;
      }
      if (progress >= profile.departureDeg) {
        detector.phase = "moving";
        detector.startAt = now;
        detector.peakDeg = progress;
        detector.lastMovedAt = now;
      }
      detector.lastAngle = angle;
      return;
    }

    if (detector.phase === "blocked") {
      if (progress <= profile.returnDeg) {
        detector.phase = "waiting";
        detector.baseline = angle;
        setStatusMessage("Başlangıç konumuna dönüldü; yeni hareket bekleniyor.");
      }
      detector.lastAngle = angle;
      return;
    }

    detector.peakDeg = Math.max(detector.peakDeg, progress);
    if (changed) detector.lastMovedAt = now;
    const duration = now - detector.startAt;

    if (now - detector.lastMovedAt > profile.stillTimeoutMs) {
      recordMovement(
        "geçersiz",
        detector.peakDeg,
        duration,
        "Hareket tamamlanmadan 2,5 sn hareketsiz kalındı; aday reddedildi.",
        false,
      );
      detector.phase = "blocked";
      detector.lastAngle = angle;
      return;
    }

    if (duration > profile.maxDurationMs * 1.5) {
      recordMovement("geçersiz", detector.peakDeg, duration, "Hareket zaman aşımına uğradı; aday reddedildi.", false);
      detector.phase = "blocked";
      detector.lastAngle = angle;
      return;
    }

    if (progress <= profile.returnDeg) {
      const peak = detector.peakDeg;
      if (peak >= profile.fullThresholdDeg) {
        if (duration < profile.minDurationMs) {
          recordMovement("tam", peak, duration, "Tam açı görüldü ancak hareket deneysel alt süre sınırından hızlıydı.", false);
        } else if (duration > profile.maxDurationMs) {
          recordMovement("tam", peak, duration, "Tam açı görüldü ancak hareket deneysel üst süre sınırını aştı.", false);
        } else {
          recordMovement("tam", peak, duration, "Kalibre tam hareket eşiği ve süre aralığı karşılandı.", true);
        }
      } else if (peak >= profile.halfThresholdDeg) {
        recordMovement("yarım", peak, duration, "Yarım hareket aralığında kaldı; geçerli tekrara eklenmedi.", false);
      } else {
        recordMovement("gürültü", peak, duration, "Yarım hareket eşiğinin altında; gürültü/çok kısa hareket olarak ayrıldı.", false);
      }
      detector.phase = "waiting";
      detector.baseline = angle;
      detector.peakDeg = 0;
    }
    detector.lastAngle = angle;
  };

  function finishCalibration() {
    if (!calibrationRunningRef.current) return;
    calibrationRunningRef.current = false;
    setCalibrationRunning(false);
    setCalibrationSeconds(0);
    if (calibrationIntervalRef.current !== null) {
      window.clearInterval(calibrationIntervalRef.current);
      calibrationIntervalRef.current = null;
    }
    const result = deriveCalibration(calibrationSamplesRef.current);
    if (!result.profile) {
      setCalibration(null);
      setCalibrationMessage(result.error ?? "Kalibrasyon tamamlanamadı.");
      return;
    }
    setCalibration(result.profile);
    calibrationRef.current = result.profile;
    setCalibrationMessage(
      `Kalibrasyon tamamlandı: ${axisLabel(result.profile.axis)}, ${result.profile.spanDeg.toFixed(0)}° kişisel aralık.`,
    );
    setStatusMessage("Kalibrasyon hazır. Kayda kol düz konumdayken başlayın.");
  }

  function startCalibration() {
    if (permission !== "granted" || !signalFresh) {
      setCalibrationMessage("Önce sensör iznini verin ve canlı değerlerin gelmesini bekleyin.");
      return;
    }
    if (recordingRef.current) return;
    calibrationSamplesRef.current = [];
    calibrationRunningRef.current = true;
    setCalibrationRunning(true);
    setCalibration(null);
    calibrationRef.current = null;
    setCalibrationSeconds(Math.ceil(CALIBRATION_MS / 1000));
    setCalibrationMessage("İlk 1 sn kol düz; ardından 3 rahat tam curl yapın.");
    const startedAt = performance.now();
    calibrationIntervalRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((CALIBRATION_MS - (performance.now() - startedAt)) / 1000));
      setCalibrationSeconds(remaining);
    }, 200);
    calibrationTimeoutRef.current = window.setTimeout(finishCalibration, CALIBRATION_MS);
  }

  function appendCalibrationRecord(profile: CalibrationProfile) {
    const row = emptyCsvRecord(exerciseRef.current, placementRef.current);
    csvRecordsRef.current.push({
      ...row,
      timestamp: profile.calibratedAt,
      elapsed_ms: 0,
      record_type: "calibration",
      reason: "Kullanıcı başlatmalı kişisel kalibrasyon; eşikler deneyseldir.",
      selected_axis: profile.axis,
      calibration_span_deg: Number(profile.spanDeg.toFixed(2)),
      half_threshold_deg: Number(profile.halfThresholdDeg.toFixed(2)),
      full_threshold_deg: Number(profile.fullThresholdDeg.toFixed(2)),
      valid_reps: 0,
      half_candidates: 0,
    });
  }

  function startOrStopRecording() {
    if (recordingRef.current) {
      recordingRef.current = false;
      setRecording(false);
      elapsedRef.current = Math.max(0, Math.round(performance.now() - recordingStartedAtRef.current));
      setElapsedMs(elapsedRef.current);
      setSampleCount(sampleCountRef.current);
      setStatusMessage("Kayıt durduruldu. CSV indirilebilir veya kayıt sürdürülebilir.");
      return;
    }

    if (permission !== "granted" || !signalFresh) {
      setStatusMessage("Kayıt için sensör izni ve canlı sensör akışı gerekiyor.");
      return;
    }
    if (exerciseRef.current === "Biceps Curl" && !calibrationRef.current) {
      setStatusMessage("Biceps Curl doğrulaması için önce kişisel kalibrasyonu tamamlayın.");
      return;
    }

    if (!sessionStartedRef.current) {
      csvRecordsRef.current = [];
      sampleCountRef.current = 0;
      candidateIdRef.current = 0;
      statsRef.current = { ...EMPTY_STATS };
      setStats({ ...EMPTY_STATS });
      setHistory([]);
      elapsedRef.current = 0;
      if (exerciseRef.current === "Biceps Curl" && calibrationRef.current) {
        appendCalibrationRecord(calibrationRef.current);
      }
      sessionStartedRef.current = true;
      setSessionStarted(true);
    }

    recordingStartedAtRef.current = performance.now() - elapsedRef.current;
    const profile = calibrationRef.current;
    if (exerciseRef.current === "Biceps Curl" && profile && latestSmoothedRef.current) {
      const currentAngle = latestSmoothedRef.current[profile.axis];
      detectorRef.current = {
        phase: "waiting",
        baseline: currentAngle,
        startAt: 0,
        peakDeg: 0,
        lastAngle: currentAngle,
        lastMovedAt: performance.now(),
      };
    } else {
      detectorRef.current = null;
    }
    recordingRef.current = true;
    setRecording(true);
    setStatusMessage(
      exerciseRef.current === "Biceps Curl"
        ? "Kayıt başladı. Kol düz konumdan hareket edin."
        : "Veri toplama başladı; bu egzersizde tekrar sınıflandırması yapılmıyor.",
    );
  }

  function resetSession() {
    recordingRef.current = false;
    setRecording(false);
    sessionStartedRef.current = false;
    setSessionStarted(false);
    csvRecordsRef.current = [];
    sampleCountRef.current = 0;
    setSampleCount(0);
    elapsedRef.current = 0;
    setElapsedMs(0);
    statsRef.current = { ...EMPTY_STATS };
    setStats({ ...EMPTY_STATS });
    setHistory([]);
    candidateIdRef.current = 0;
    detectorRef.current = null;
    setFocusMode(false);
    setFeedback(null);
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
    if (vibrationSupported) navigator.vibrate(0);
    setStatusMessage("Oturum sıfırlandı; Biceps kalibrasyonu korundu.");
  }

  function downloadCsv() {
    if (!csvRecordsRef.current.length || sampleCountRef.current === 0) return;
    const lines = [
      CSV_COLUMNS.join(","),
      ...csvRecordsRef.current.map((record) => CSV_COLUMNS.map((column) => csvValue(record[column])).join(",")),
    ];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `repcounter_v0.5_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMessage("CSV hazırlandı: ham örnekler, kalibrasyon ve hareket sınıfları birlikte kaydedildi.");
  }

  function changeExercise(nextExercise: string) {
    setExercise(nextExercise);
    const option = EXERCISES.find((item) => item.name === nextExercise);
    if (option) setPlacement(option.placement);
    setStatusMessage(nextExercise === "Biceps Curl" ? "Biceps Curl doğrulama modu seçildi." : "Yalnızca veri toplama modu seçildi.");
  }

  const completedSets = Math.min(3, Math.floor(stats.valid / 10));
  const currentSetProgress = stats.valid >= 30 ? 10 : stats.valid % 10;
  const goalCompleted = stats.valid >= 30;
  const isBiceps = exercise === "Biceps Curl";
  const settingsLocked = recording || sessionStarted;
  const permissionLabel =
    permission === "granted"
      ? "Sensörler açık"
      : permission === "requesting"
        ? "İzin bekleniyor"
        : permission === "denied"
          ? "İzin verilmedi"
          : "Sensör izni ver";

  return (
    <>
      {feedback && (
        <div key={feedback.id} className={`feedback-toast ${feedback.kind}`} role="status" aria-live="assertive">
          <span aria-hidden="true">{feedback.kind === "set" ? "◆" : "✓"}</span>
          <div>
            <strong>{feedback.title}</strong>
            <small>{feedback.detail}</small>
          </div>
        </div>
      )}

      {focusMode && (
        <section className="focus-overlay" role="dialog" aria-modal="true" aria-label="Büyük sayaç odak modu">
          <header className="focus-header">
            <div>
              <span className={`signal-dot ${signalFresh ? "active" : ""}`} />
              {recording ? "Kayıt ve sensör akışı sürüyor" : "Kayıt duraklatıldı"}
            </div>
            <button className="focus-exit" type="button" onClick={() => setFocusMode(false)} autoFocus>
              <span aria-hidden="true">×</span> Odaktan çık
            </button>
          </header>
          <div key={feedback?.id ?? 0} className={`focus-counter-panel ${feedback ? `feedback-${feedback.kind}` : ""}`}>
            <span className="focus-kicker">{goalCompleted ? "3 SET TAMAM" : `${Math.min(3, completedSets + 1)}. SET`}</span>
            <strong className="focus-count">{currentSetProgress}</strong>
            <span className="focus-target">/ 10</span>
            <p>{stats.valid} toplam geçerli tekrar</p>
          </div>
          <div className="focus-stats">
            <div><span>Set</span><strong>{completedSets}/3</strong></div>
            <div><span>Yarım</span><strong>{stats.halfCandidates}</strong></div>
            <div><span>Reddedilen</span><strong>{stats.rejected}</strong></div>
            <div><span>Süre</span><strong>{formatSessionDuration(elapsedMs)}</strong></div>
          </div>
        </section>
      )}

      <main className="app-shell" aria-hidden={focusMode ? true : undefined}>
      <header className="hero">
        <div className="version-pill">v0.5 · Akıllı Tekrar Doğrulama</div>
        <h1>AI RepCounter</h1>
        <p>Telefon sensörleriyle kişisel hareket aralığını ölç, ham veriyi kaydet ve curl adaylarını incele.</p>
      </header>

      <section className="notice-card" aria-label="Deneysel sürüm açıklaması">
        <span className="notice-icon">i</span>
        <div>
          <strong>Deneysel sensör eşikleri</strong>
          <p>
            Bu sürüm eğitilmiş bir AI modeli veya form doğruluk puanı kullanmaz. Sonuçlar kişisel kalibrasyon ve
            açıklanan açı/süre kurallarına dayanır.
          </p>
        </div>
      </section>

      <section className="card permission-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">1 · HAZIRLIK</span>
            <h2>Sensör erişimi</h2>
          </div>
          <span className={`signal-badge ${signalFresh ? "active" : ""}`}>
            <span className="signal-dot" /> {signalFresh ? "Canlı" : "Bekleniyor"}
          </span>
        </div>
        <button
          className={`primary-button ${permission === "granted" ? "granted" : ""}`}
          type="button"
          onClick={requestSensorPermission}
          disabled={permission === "requesting" || permission === "granted"}
        >
          <span aria-hidden="true">◉</span> {permissionLabel}
        </button>
        <p className="helper-text">{permissionMessage}</p>
        <p className="microcopy">iPhone Safari’de HTTPS ve düğmeye dokunma zorunludur. Ekran kilitlenirse sensör akışı durabilir.</p>
        <div className="vibration-setting">
          <div>
            <strong>Titreşim geri bildirimi</strong>
            <span>Geçerli tekrarda kısa, tamamlanan sette çift titreşim.</span>
          </div>
          <button
            className={`switch-button ${vibrationEnabled && vibrationSupported ? "on" : ""}`}
            type="button"
            role="switch"
            aria-checked={vibrationEnabled && vibrationSupported}
            onClick={toggleVibration}
            disabled={!vibrationSupported}
          >
            <span aria-hidden="true" />
            {vibrationSupported ? (vibrationEnabled ? "Açık" : "Kapalı") : "Yok"}
          </button>
        </div>
        {!vibrationSupported && (
          <div className="compatibility-note" role="note">
            <span aria-hidden="true">◌</span>
            <p><strong>Görsel bildirim etkin.</strong> Bu tarayıcı titreşim API’sini sunmuyor; iOS Safari’de de desteklenmez. Geçerli tekrar ve setler ekranda gösterilir.</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">2 · KAYIT AYARLARI</span>
            <h2>Egzersiz ve telefon konumu</h2>
          </div>
        </div>
        <label className="field-label" htmlFor="exercise">
          Egzersiz
        </label>
        <select id="exercise" value={exercise} onChange={(event) => changeExercise(event.target.value)} disabled={settingsLocked}>
          {EXERCISES.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="placement">
          Telefonun sabitlendiği yer
        </label>
        <select id="placement" value={placement} onChange={(event) => setPlacement(event.target.value)} disabled={settingsLocked}>
          {PLACEMENTS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {!isBiceps && (
          <div className="data-only-note">
            <strong>Veri toplama modu</strong>
            <span>Bu egzersizde yalnızca ham sensör verisi kaydedilir; tekrar veya form sınıflandırması yapılmaz.</span>
          </div>
        )}
      </section>

      {isBiceps && (
        <section className="card calibration-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">3 · BICEPS CURL</span>
              <h2>Kişisel kalibrasyon</h2>
            </div>
            <span className={`state-chip ${calibration ? "success" : calibrationRunning ? "running" : ""}`}>
              {calibration ? "Hazır" : calibrationRunning ? `${calibrationSeconds} sn` : "Gerekli"}
            </span>
          </div>
          <ol className="calibration-steps">
            <li>Telefonu ön kol/bileğe sıkıca sabitleyin.</li>
            <li>Başlatınca ilk 1 saniye kolu düz ve sakin tutun.</li>
            <li>Ardından 3 rahat tam curl yapıp düz konuma dönün.</li>
          </ol>
          <button
            className="secondary-button"
            type="button"
            onClick={startCalibration}
            disabled={calibrationRunning || recording || permission !== "granted"}
          >
            {calibrationRunning ? `Kalibre ediliyor · ${calibrationSeconds}` : calibration ? "Yeniden kalibre et" : "Kalibrasyonu başlat"}
          </button>
          <p className={`helper-text ${calibration ? "success-text" : ""}`}>{calibrationMessage}</p>

          {calibration && (
            <div className="threshold-panel">
              <div className="threshold-title">
                <span>Deneysel eşikler</span>
                <small>{axisLabel(calibration.axis)} ekseni otomatik seçildi</small>
              </div>
              <div className="threshold-grid">
                <div>
                  <span>Kişisel aralık</span>
                  <strong>{calibration.spanDeg.toFixed(0)}°</strong>
                </div>
                <div>
                  <span>Yarım aday</span>
                  <strong>≥ {calibration.halfThresholdDeg.toFixed(0)}°</strong>
                </div>
                <div>
                  <span>Tam aday</span>
                  <strong>≥ {calibration.fullThresholdDeg.toFixed(0)}°</strong>
                </div>
                <div>
                  <span>Kabul süresi</span>
                  <strong>0,7–8,0 sn</strong>
                </div>
              </div>
              <p>Açı sarmalanması düzeltilir; yumuşatma, gürültü tabanı ve dönüş histerezisi uygulanır.</p>
            </div>
          )}
        </section>
      )}

      <section className="card session-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{isBiceps ? "4" : "3"} · OTURUM</span>
            <h2>Kayıt kontrolü</h2>
          </div>
          <span className={`recording-badge ${recording ? "active" : ""}`}>{recording ? "● Kayıtta" : "Hazır"}</span>
        </div>

        <div className="metric-grid two-columns">
          <div className="metric-box">
            <span>Örnek sayısı</span>
            <strong>{sampleCount.toLocaleString("tr-TR")}</strong>
          </div>
          <div className="metric-box">
            <span>Süre</span>
            <strong>
              {Math.floor(elapsedMs / 1000)} <small>sn</small>
            </strong>
          </div>
        </div>

        <div className="button-row">
          <button className={`primary-button record-button ${recording ? "stop" : ""}`} type="button" onClick={startOrStopRecording}>
            <span aria-hidden="true">{recording ? "■" : "▶"}</span> {recording ? "Kaydı durdur" : sessionStarted ? "Kaydı sürdür" : "Kaydı başlat"}
          </button>
          <button className="reset-button" type="button" onClick={resetSession} disabled={!sessionStarted && !sampleCount}>
            ↻ <span>Sıfırla</span>
          </button>
        </div>
        <p className="status-line" role="status">
          {statusMessage}
        </p>
        <button className="download-button" type="button" onClick={downloadCsv} disabled={sampleCount === 0}>
          ⇩ CSV verilerini indir
        </button>
        <p className="microcopy centered">Sıfırlama, oturum verisini ve sayaçları temizler; tamamlanmış Biceps kalibrasyonunu korur.</p>
      </section>

      {sessionStarted && (
        <section className={`card summary-card ${recording ? "live" : "finished"}`}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">{recording ? "CANLI ÖZET" : "OTURUM SONU"}</span>
              <h2>Antrenman özeti</h2>
            </div>
            <span className={`state-chip ${recording ? "running" : "success"}`}>{recording ? "Sürüyor" : "Kaydedildi"}</span>
          </div>
          <dl className="summary-grid">
            <div className="summary-exercise"><dt>Egzersiz</dt><dd>{exercise}</dd></div>
            <div><dt>Geçerli</dt><dd>{stats.valid}</dd></div>
            <div><dt>Yarım</dt><dd>{stats.halfCandidates}</dd></div>
            <div><dt>Reddedilen</dt><dd>{stats.rejected}</dd></div>
            <div><dt>Set</dt><dd>{isBiceps ? `${completedSets}/3` : "—"}</dd></div>
            <div><dt>Süre</dt><dd>{formatSessionDuration(elapsedMs)}</dd></div>
          </dl>
          {!recording && <p className="summary-note">Özet, kaydı durdurduktan sonra ekranda kalır. Yeni oturum için “Sıfırla”yı kullanın.</p>}
        </section>
      )}

      {isBiceps && (
        <section className="card validation-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">5 · DOĞRULAMA</span>
              <h2>Tekrar ve set hedefi</h2>
            </div>
            <span className={`state-chip ${goalCompleted ? "success" : ""}`}>{goalCompleted ? "Hedef tamam" : `${completedSets}/3 set`}</span>
          </div>

          <div className="rep-hero">
            <div className="progress-ring" style={{ "--progress": `${currentSetProgress * 36}deg` } as React.CSSProperties}>
              <div>
                <strong>{currentSetProgress}</strong>
                <span>/ 10</span>
              </div>
            </div>
            <div className="set-summary">
              <span>{goalCompleted ? "3 set tamamlandı" : `${Math.min(3, completedSets + 1)}. set ilerlemesi`}</span>
              <strong>{stats.valid} geçerli tam tekrar</strong>
              <div className="set-dots" aria-label={`${completedSets} set tamamlandı`}>
                {[0, 1, 2].map((index) => (
                  <span key={index} className={index < completedSets ? "complete" : index === completedSets && !goalCompleted ? "current" : ""} />
                ))}
              </div>
            </div>
          </div>

          <button className="focus-button" type="button" onClick={() => setFocusMode(true)} disabled={!sessionStarted}>
            <span aria-hidden="true">⛶</span> Büyük sayaç odak modunu aç
          </button>

          <div className="metric-grid three-columns">
            <div className="metric-box compact accepted">
              <span>Tam aday</span>
              <strong>{stats.fullCandidates}</strong>
            </div>
            <div className="metric-box compact partial">
              <span>Yarım aday</span>
              <strong>{stats.halfCandidates}</strong>
            </div>
            <div className="metric-box compact rejected">
              <span>Reddedilen</span>
              <strong>{stats.rejected}</strong>
            </div>
          </div>
        </section>
      )}

      {isBiceps && (
        <section className="card history-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">HAREKET GÜNLÜĞÜ</span>
              <h2>Aday geçmişi</h2>
            </div>
            <span className="count-chip">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">
              <span>↕</span>
              <p>Kayıt sırasında tamamlanan hareketlerin açı, süre ve karar gerekçesi burada görünür.</p>
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <article className="history-item" key={item.id}>
                  <div className={`class-icon ${item.accepted ? "accepted" : item.className}`}>{item.accepted ? "✓" : "!"}</div>
                  <div className="history-copy">
                    <div className="history-topline">
                      <strong>#{item.id} · {item.className === "tam" ? "Tam hareket" : item.className === "yarım" ? "Yarım hareket" : item.className === "gürültü" ? "Gürültü/kısa" : "Geçersiz"}</strong>
                      <time>{new Date(item.timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    </div>
                    <div className="history-metrics">
                      <span>{item.angleDeg.toFixed(0)}° açı</span>
                      <span>{formatDuration(item.durationMs)}</span>
                      <span>{item.accepted ? `${item.setNumber}. set` : "Sayılmadı"}</span>
                    </div>
                    <p>{item.reason}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="card live-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CANLI TELEMETRİ</span>
            <h2>Canlı sensör değerleri</h2>
          </div>
          <span className={`signal-badge ${signalFresh ? "active" : ""}`}>{signalFresh ? "Canlı" : "Pasif"}</span>
        </div>
        <p className="helper-text">İvme (m/s²), dönüş hızı (°/sn) ve cihaz yönelimi (°).</p>
        <div className="sensor-grid">
          <div><span>İvme X</span><strong>{displayNumber(liveMotion.ax)}</strong></div>
          <div><span>İvme Y</span><strong>{displayNumber(liveMotion.ay)}</strong></div>
          <div><span>İvme Z</span><strong>{displayNumber(liveMotion.az)}</strong></div>
          <div><span>Jiroskop α</span><strong>{displayNumber(liveMotion.gx)}</strong></div>
          <div><span>Jiroskop β</span><strong>{displayNumber(liveMotion.gy)}</strong></div>
          <div><span>Jiroskop γ</span><strong>{displayNumber(liveMotion.gz)}</strong></div>
          <div><span>Yön Alpha</span><strong>{displayNumber(liveOrientation.alpha)}</strong></div>
          <div><span>Yön Beta</span><strong>{displayNumber(liveOrientation.beta)}</strong></div>
          <div><span>Yön Gamma</span><strong>{displayNumber(liveOrientation.gamma)}</strong></div>
        </div>
        <div className="chart-heading">
          <span>İvme X · son 80 görünür örnek</span>
          <span>{signalFresh ? "Canlı" : "Bekleniyor"}</span>
        </div>
        <Sparkline values={sparkValues} />
      </section>

      <footer>
        <strong>AI RepCounter v0.5</strong>
        <span>Deneysel araştırma prototipi · Tıbbi veya profesyonel antrenör değerlendirmesi değildir.</span>
      </footer>
      </main>
    </>
  );
}
