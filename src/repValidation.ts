export type OrientationAxis = "alpha" | "beta" | "gamma";

export interface OrientationPoint {
  t: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface CalibrationProfile {
  axis: OrientationAxis;
  extensionAngle: number;
  flexAngle: number;
  direction: 1 | -1;
  spanDeg: number;
  returnDeg: number;
  departureDeg: number;
  halfThresholdDeg: number;
  fullThresholdDeg: number;
  noiseFloorDeg: number;
  minDurationMs: number;
  maxDurationMs: number;
  stillTimeoutMs: number;
  sampleCount: number;
  calibratedAt: string;
}

export interface CalibrationResult {
  profile: CalibrationProfile | null;
  error: string | null;
}

const AXES: OrientationAxis[] = ["alpha", "beta", "gamma"];

export function unwrapAngle(current: number, previousRaw: number, previousUnwrapped: number): number {
  const delta = ((current - previousRaw + 540) % 360) - 180;
  return previousUnwrapped + delta;
}

export function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, ratio));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function deriveCalibration(samples: OrientationPoint[]): CalibrationResult {
  if (samples.length < 80) {
    return { profile: null, error: "Yeterli sensör örneği alınamadı. Telefonu sabitleyip tekrar deneyin." };
  }

  const ranges = AXES.map((axis) => {
    const values = samples.map((sample) => sample[axis]);
    return { axis, range: percentile(values, 0.9) - percentile(values, 0.1) };
  }).sort((a, b) => b.range - a.range);

  const axis = ranges[0].axis;
  const values = samples.map((sample) => sample[axis]);
  const quietEnd = samples[0].t + 1000;
  const startValues = samples.filter((sample) => sample.t <= quietEnd).map((sample) => sample[axis]);
  const extensionAngle = percentile(startValues.length >= 8 ? startValues : values.slice(0, 20), 0.5);
  const low = percentile(values, 0.08);
  const high = percentile(values, 0.92);
  const direction: 1 | -1 = Math.abs(high - extensionAngle) >= Math.abs(low - extensionAngle) ? 1 : -1;
  const flexAngle = direction === 1 ? high : low;
  const spanDeg = Math.abs(flexAngle - extensionAngle);

  if (spanDeg < 35) {
    return {
      profile: null,
      error: `Hareket aralığı yalnızca ${spanDeg.toFixed(0)}°. Kalibrasyonda kolu düz tutup 3 rahat tekrar yapın.`,
    };
  }

  const quietValues = startValues.length >= 8 ? startValues : values.slice(0, 20);
  const quietDiffs = quietValues.slice(1).map((value, index) => Math.abs(value - quietValues[index]));
  const noiseFloorDeg = Math.min(4, Math.max(0.6, percentile(quietDiffs, 0.85) * 2));

  return {
    profile: {
      axis,
      extensionAngle,
      flexAngle,
      direction,
      spanDeg,
      returnDeg: Math.max(6, spanDeg * 0.12, noiseFloorDeg * 3),
      departureDeg: Math.max(12, spanDeg * 0.2, noiseFloorDeg * 4),
      halfThresholdDeg: Math.max(22, spanDeg * 0.45),
      fullThresholdDeg: Math.max(35, spanDeg * 0.75),
      noiseFloorDeg,
      minDurationMs: 700,
      maxDurationMs: 8000,
      stillTimeoutMs: 2500,
      sampleCount: samples.length,
      calibratedAt: new Date().toISOString(),
    },
    error: null,
  };
}

export function axisLabel(axis: OrientationAxis): string {
  return axis === "alpha" ? "Alpha (Z)" : axis === "beta" ? "Beta (X)" : "Gamma (Y)";
}
