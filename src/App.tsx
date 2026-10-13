import { useEffect, useRef, useState } from 'react';

import {
  Activity,
  Download,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
} from 'lucide-react';

type MotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

type OrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

type Sample = {
  timestamp: string;
  elapsed_ms: number;
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
};

const exercises = [
  'Incline Dumbbell Press',
  'Shoulder Press',
  'Lateral Raise',
  'Triceps Push-down',
  'Biceps Curl',
];

const placements = ['Ön kol / bilek', 'Üst kol', 'Göğüs / gövde', 'Cep', 'Diğer'];

const num = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const display = (value: number | null) => (value === null ? '—' : value.toFixed(2));

function Spark({ values, color }: { values: number[]; color: string }) {
  const width = 320;
  const height = 82;
  const max = Math.max(12, ...values.map((value) => Math.abs(value)));
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(1, values.length - 1)) * width},${
          height / 2 - (value / max) * (height / 2 - 6)
        }`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="spark"
      role="img"
      aria-label="Son hareket örnekleri grafiği"
    >
      <path d={`M0 ${height / 2} H${width}`} stroke="#334155" strokeDasharray="4 4" />
      <polyline
        points={points}
        stroke={color}
        strokeWidth="2.5"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const [status, setStatus] = useState('Hazır — sensör izni bekleniyor');
  const [permission, setPermission] = useState(false);
  const [recording, setRecording] = useState(false);
  const [exercise, setExercise] = useState(exercises[0]);
  const [placement, setPlacement] = useState(placements[0]);
  const [latest, setLatest] = useState<Sample | null>(null);
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [graph, setGraph] = useState<number[]>([]);
  const [reps, setReps] = useState(0);
  const [sets, setSets] = useState(0);
  const [repNote, setRepNote] = useState('Önce Biceps Curl seçip kaydı başlat.');
  const detector = useRef({
    smooth: null as number | null,
    low: Infinity,
    high: -Infinity,
    phase: 'seekPeak' as 'seekPeak' | 'seekTrough',
    peak: -Infinity,
    trough: Infinity,
    peakAt: 0,
    lastRepAt: -99999,
  });

  const samples = useRef<Sample[]>([]);
  const recordingRef = useRef(false);
  const startRef = useRef(0);
  const lastSampleRef = useRef(0);
  const latestRef = useRef<Sample | null>(null);
  const orientationRef = useRef({
    alpha: null as number | null,
    beta: null as number | null,
    gamma: null as number | null,
  });
  const configRef = useRef({ exercise, placement });
  const hasMotionRef = useRef(false);

  useEffect(() => {
    configRef.current = { exercise, placement };
  }, [exercise, placement]);

  useEffect(() => {
    const onOrientation = (event: DeviceOrientationEvent) => {
      orientationRef.current = {
        alpha: num(event.alpha),
        beta: num(event.beta),
        gamma: num(event.gamma),
      };
    };

    const onMotion = (event: DeviceMotionEvent) => {
      hasMotionRef.current = true;

      const now = performance.now();
      if (now - lastSampleRef.current < 18) return;

      lastSampleRef.current = now;

      const acceleration = event.accelerationIncludingGravity;
      const rotation = event.rotationRate;
      const sample: Sample = {
        timestamp: new Date().toISOString(),
        elapsed_ms: recordingRef.current ? Math.round(now - startRef.current) : 0,
        exercise: configRef.current.exercise,
        placement: configRef.current.placement,
        ax: num(acceleration?.x),
        ay: num(acceleration?.y),
        az: num(acceleration?.z),
        gx: num(rotation?.alpha),
        gy: num(rotation?.beta),
        gz: num(rotation?.gamma),
        ...orientationRef.current,
      };

      latestRef.current = sample;

      if (recordingRef.current) {
        samples.current.push(sample);
        setCount(samples.current.length);

        if (
          configRef.current.exercise === 'Biceps Curl' &&
          configRef.current.placement === 'Ön kol / bilek' &&
          sample.gamma !== null
        ) {
          const currentDetector = detector.current;
          const time = now - startRef.current;

          currentDetector.smooth =
            currentDetector.smooth === null
              ? sample.gamma
              : currentDetector.smooth * 0.82 + sample.gamma * 0.18;

          const value = currentDetector.smooth;

          // A rising gamma peak followed by a falling gamma trough constitutes one candidate cycle.
          // The calibrated 90 degree threshold rejects the observed partial repetitions.
          if (currentDetector.phase === 'seekPeak') {
            if (value > currentDetector.peak) {
              currentDetector.peak = value;
              currentDetector.peakAt = time;
            }

            if (currentDetector.peak - value > 18 && currentDetector.peak > 20) {
              currentDetector.phase = 'seekTrough';
              currentDetector.trough = value;
            }
          } else {
            currentDetector.trough = Math.min(currentDetector.trough, value);

            const amplitude = currentDetector.peak - currentDetector.trough;
            const duration = time - currentDetector.peakAt;

            if (value - currentDetector.trough > 12) {
              if (
                amplitude >= 90 &&
                duration >= 350 &&
                duration <= 3500 &&
                time - currentDetector.lastRepAt >= 1000
              ) {
                currentDetector.lastRepAt = time;
                setReps((previousReps) => {
                  if (previousReps >= 9) {
                    setSets((previousSets) => Math.min(3, previousSets + 1));
                    setRepNote('10 tam tekrar adayı — set tamamlandı');
                    return 0;
                  }

                  setRepNote(
                    `Tam tekrar adayı kabul edildi: ${amplitude.toFixed(0)}°`,
                  );
                  return previousReps + 1;
                });
              } else {
                setRepNote(
                  `Eksik / belirsiz döngü: ${amplitude.toFixed(0)}° (eşik 90°)`,
                );
              }

              currentDetector.phase = 'seekPeak';
              currentDetector.peak = value;
              currentDetector.peakAt = time;
              currentDetector.trough = Infinity;
            } else if (duration > 4500) {
              currentDetector.phase = 'seekPeak';
              currentDetector.peak = value;
              currentDetector.peakAt = time;
              currentDetector.trough = Infinity;
            }
          }
        }
      }

      setLatest(sample);
      setGraph((previousValues) => [...previousValues.slice(-79), sample.ax ?? 0]);
    };

    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, []);

  useEffect(() => {
    if (!recording) return;

    const timer = window.setInterval(
      () => setElapsed(Math.round((performance.now() - startRef.current) / 1000)),
      250,
    );

    return () => clearInterval(timer);
  }, [recording]);

  async function grant() {
    if (!window.isSecureContext) {
      setStatus('HTTPS gerekli. iPhone üzerinde güvenli HTTPS adresi aç.');
      return;
    }

    if (!('DeviceMotionEvent' in window)) {
      setStatus('Bu tarayıcı hareket sensörlerini desteklemiyor. iPhone Safari ile aç.');
      return;
    }

    try {
      const deviceMotion = DeviceMotionEvent as MotionEventWithPermission;
      const deviceOrientation = DeviceOrientationEvent as OrientationEventWithPermission;
      const motionPermission =
        typeof deviceMotion.requestPermission === 'function'
          ? await deviceMotion.requestPermission()
          : 'granted';
      const orientationPermission =
        typeof deviceOrientation.requestPermission === 'function'
          ? await deviceOrientation.requestPermission()
          : 'granted';

      if (motionPermission !== 'granted' || orientationPermission !== 'granted') {
        setStatus('Sensör izni reddedildi. Safari ayarlarını kontrol et.');
        return;
      }

      setPermission(true);
      setStatus('İzin verildi. Telefonu hareket ettirerek değerleri kontrol et.');
    } catch (error) {
      setStatus(`İzin hatası: ${String(error)}`);
    }
  }

  function start() {
    if (!permission) {
      setStatus('Önce sensör izni ver.');
      return;
    }

    if (!hasMotionRef.current) {
      setStatus('Henüz hareket verisi gelmedi. iPhone Safari üzerinden dene.');
      return;
    }

    samples.current = [];
    setCount(0);
    setElapsed(0);
    detector.current = {
      smooth: null,
      low: Infinity,
      high: -Infinity,
      phase: 'seekPeak',
      peak: -Infinity,
      trough: Infinity,
      peakAt: 0,
      lastRepAt: -99999,
    };
    setReps(0);
    setSets(0);
    setRepNote('Algoritma etkin — kontrollü tekrar yap.');
    startRef.current = performance.now();
    recordingRef.current = true;
    setRecording(true);
    setStatus('Kayıt sürüyor. Hareketi normal temponda uygula.');
  }

  function stop() {
    recordingRef.current = false;
    setRecording(false);
    setStatus(`${samples.current.length} örnek kaydedildi. CSV indirebilirsin.`);
  }

  function reset() {
    if (recordingRef.current) stop();

    samples.current = [];
    setCount(0);
    setElapsed(0);
    setGraph([]);
    setReps(0);
    setSets(0);
    setRepNote('Kayıt sıfırlandı.');
    setStatus('Kayıt sıfırlandı.');
  }

  function download() {
    if (samples.current.length === 0) {
      setStatus('Önce kayıt oluştur.');
      return;
    }

    const keys: (keyof Sample)[] = [
      'timestamp',
      'elapsed_ms',
      'exercise',
      'placement',
      'ax',
      'ay',
      'az',
      'gx',
      'gy',
      'gz',
      'alpha',
      'beta',
      'gamma',
    ];
    const csv = [
      keys.join(','),
      ...samples.current.map((sample) =>
        keys
          .map((key) => {
            const value = sample[key];
            return typeof value === 'string'
              ? `"${value.replaceAll('"', '""')}"`
              : (value ?? '');
          })
          .join(','),
      ),
    ].join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `repcounter_${new Date().toISOString().replaceAll(':', '-')}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return (
    <main className="shell">
      <header>
        <div className="logo">
          <Activity size={25} />
        </div>
        <div>
          <div className="eyebrow">AI REPCOUNTER · V0.3</div>
          <h1>Sensor Lab</h1>
        </div>
        <span className="version">iOS PWA</span>
      </header>

      <section className="hero">
        <span className="pill">
          <span className="dot" />{' '}
          {recording
            ? 'KAYIT AKTİF'
            : permission
              ? 'SENSÖRLER HAZIR'
              : 'SENSÖR İZNİ GEREKLİ'}
        </span>
        <h2>
          Hareket verilerini
          <br />
          <em>anlamlı hale getir.</em>
        </h2>
        <p>
          Telefonunu sabitle, egzersizini seç ve yapay zekâ eğitimine uygun sensör
          verilerini topla.
        </p>
      </section>

      <section className="card">
        <div className="sectiontitle">
          <Smartphone size={19} /> Sensör bağlantısı
        </div>
        <p className="status" aria-live="polite">
          {status}
        </p>
        <button className="primary" onClick={grant} disabled={recording}>
          <ShieldCheck size={18} /> Sensör erişimine izin ver
        </button>
        <p className="hint">
          iPhone Safari + HTTPS gerekir. İzin düğmesine dokunmak zorunludur.
        </p>
      </section>

      <section className="card">
        <div className="sectiontitle">Kayıt ayarları</div>
        <label>Egzersiz</label>
        <select
          value={exercise}
          disabled={recording}
          onChange={(event) => setExercise(event.target.value)}
        >
          {exercises.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label>Telefonun sabitlendiği yer</label>
        <select
          value={placement}
          disabled={recording}
          onChange={(event) => setPlacement(event.target.value)}
        >
          {placements.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <div className="stats">
          <div>
            <small>ÖRNEK SAYISI</small>
            <strong>{count.toLocaleString('tr-TR')}</strong>
          </div>
          <div>
            <small>SÜRE</small>
            <strong>
              {elapsed} <span>sn</span>
            </strong>
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={recording ? stop : start}>
            {recording ? (
              <>
                <Square size={17} /> Kaydı durdur
              </>
            ) : (
              <>
                <Play size={17} /> Kaydı başlat
              </>
            )}
          </button>
          <button className="secondary" onClick={reset}>
            <RotateCcw size={17} /> Sıfırla
          </button>
        </div>
        <button className="export" onClick={download} disabled={recording || count === 0}>
          <Download size={17} /> CSV verilerini indir
        </button>
      </section>

      <section className="card">
        <div className="sectiontitle">
          <Activity size={19} /> Biceps Curl — tekrar sayacı (beta)
        </div>
        <p className="hint">
          Yalnızca Biceps Curl + Ön kol / bilek seçiliyken çalışır. Gamma tepe-dip
          değişimini izler; 90° ve zaman eşikleriyle eksik döngüleri filtreler. Henüz
          yapay zekâ veya anatomik form doğrulaması değildir.
        </p>
        <div className="stats">
          <div>
            <small>TEKRAR / 10</small>
            <strong>{reps}</strong>
          </div>
          <div>
            <small>SET / 3</small>
            <strong>{sets}</strong>
          </div>
        </div>
        <p className="status">{repNote}</p>
        <div className="actions">
          <button className="secondary" onClick={() => setReps((value) => Math.max(0, value - 1))}>
            −1 tekrar
          </button>
          <button
            className="secondary"
            onClick={() =>
              setReps((value) => {
                if (value === 9) {
                  setSets((previousSets) => Math.min(3, previousSets + 1));
                  return 0;
                }
                return value + 1;
              })
            }
          >
            +1 tekrar
          </button>
        </div>
        <p className="hint">
          Elle düzeltme, sensörün kaçırdığı veya fazladan saydığı tekrarları not etmek
          içindir. Set tamamlandığında sayaç sıfırlanır.
        </p>
      </section>

      <section className="card">
        <div className="sectiontitle">
          <Activity size={19} /> Canlı sensör değerleri
        </div>
        <p className="hint">İvme (m/s²), dönüş hızı (°/sn, tarayıcı desteğine bağlı)</p>
        <div className="measurements">
          {(
            [
              ['İvme X', latest?.ax],
              ['İvme Y', latest?.ay],
              ['İvme Z', latest?.az],
              ['Jiroskop X*', latest?.gx],
              ['Jiroskop Y*', latest?.gy],
              ['Jiroskop Z*', latest?.gz],
            ] as const
          ).map(([name, value]) => (
            <div className="measure" key={name}>
              <small>{name}</small>
              <strong>{display(value ?? null)}</strong>
            </div>
          ))}
        </div>
        <div className="charthead">
          <span>İvme X · son 80 örnek</span>
          <span>Canlı</span>
        </div>
        <Spark values={graph} color="#67e8f9" />
        <p className="hint">
          * RotationRate alanları tarayıcının alpha/beta/gamma eksenlerinden alınır;
          fiziksel eksen eşlemesi cihaz yönüne göre kalibre edilmelidir. Örnekleme hızı
          cihaz ve tarayıcı tarafından belirlenir, sabit 50 Hz garantisi yoktur.
        </p>
      </section>

      <footer>
        Veriler yalnızca bu sayfanın belleğinde tutulur. Sayfayı kapatmadan CSV dosyanı
        indir. Biceps Curl için deneysel tekrar sayımı vardır; otomatik hareket tanıma ve
        form doğrulama henüz yoktur.
      </footer>
    </main>
  );
}
