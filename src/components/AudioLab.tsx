import React, { useCallback, useEffect, useRef, useState } from 'react';
import { soundSynth } from '../utils/audio';
import type { CueVariant } from '../utils/audio';
import { CUE_VARIANT_LABELS } from '../utils/audio';

type StepAction = 'inhale' | 'inhale-topup' | 'hold' | 'exhale';

interface LabStep {
  action: StepAction;
  duration: number;
}

const SEQUENCES: Record<string, { label: string; steps: LabStep[] }> = {
  '4-7-8': {
    label: '4-7-8 (4s / 7s / 8s)',
    steps: [
      { action: 'inhale', duration: 4 },
      { action: 'hold', duration: 7 },
      { action: 'exhale', duration: 8 },
    ],
  },
  'physiological-sigh': {
    label: 'Physiological sigh (2s / 1s / 6s)',
    steps: [
      { action: 'inhale', duration: 2 },
      { action: 'inhale-topup', duration: 1 },
      { action: 'exhale', duration: 6 },
    ],
  },
};

const VARIANTS = Object.keys(CUE_VARIANT_LABELS) as CueVariant[];

const ACTION_LABELS: Record<StepAction, string> = {
  inhale: 'Inhale',
  'inhale-topup': 'Top-up inhale',
  hold: 'Hold',
  exhale: 'Exhale',
};

const toDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Samples the output for a window and returns peak and RMS amplitude.
 * The analyser window is 46ms and the sampling interval is 20ms, so consecutive
 * windows barely overlap and the RMS stays close to the true average level.
 */
async function sampleLevel(analyser: AnalyserNode, durationMs: number) {
  const buffer = new Float32Array(analyser.fftSize);
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  const end = performance.now() + durationMs;

  while (performance.now() < end) {
    analyser.getFloatTimeDomainData(buffer);
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer[i];
      const amplitude = Math.abs(sample);
      if (amplitude > peak) peak = amplitude;
      sumSquares += sample * sample;
      samples++;
    }
    await sleep(20);
  }

  return { peak, rms: Math.sqrt(sumSquares / Math.max(1, samples)) };
}

/**
 * Dev-only audition harness. Reached at /?audiotest=1 and deliberately kept out of
 * the production bundle via a lazy import. It drives the real synth methods, so what
 * you hear here is exactly what the app will play.
 */
export const AudioLab: React.FC = () => {
  const [variant, setVariant] = useState<CueVariant>(soundSynth.getCueVariant());
  const [volume, setVolume] = useState(soundSynth.getVolume());
  const [isMuted, setIsMuted] = useState(soundSynth.getIsMuted());
  const [isAmbianceOn, setIsAmbianceOn] = useState(false);
  const [isDroneOn, setIsDroneOn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLabel, setCurrentLabel] = useState<string>('idle');
  const [levelReport, setLevelReport] = useState<string>('');
  const [isMeasuring, setIsMeasuring] = useState(false);

  const timers = useRef<number[]>([]);
  const isPlayingRef = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const stop = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentLabel('idle');
    clearTimers();
    soundSynth.stopBreathCue(0.25);
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
      soundSynth.stopAll(0.1);
    };
  }, [clearTimers]);

  const playStep = useCallback((step: LabStep) => {
    if (step.action === 'inhale') {
      soundSynth.playInhaleCue(step.duration);
    } else if (step.action === 'inhale-topup') {
      soundSynth.playInhaleCue(step.duration, 'topup');
    } else if (step.action === 'hold') {
      soundSynth.playHoldCue(step.duration);
    } else {
      soundSynth.playExhaleCue(step.duration);
    }
  }, []);

  const playSequence = useCallback(
    (steps: LabStep[], repeats: number) => {
      soundSynth.unlock();
      clearTimers();
      isPlayingRef.current = true;
      setIsPlaying(true);

      const run = (index: number) => {
        if (!isPlayingRef.current) return;
        const step = steps[index];
        setCurrentLabel(ACTION_LABELS[step.action]);
        playStep(step);

        const isLast = index === steps.length - 1;
        const id = window.setTimeout(
          () => {
            if (isLast) {
              if (repeats > 1) {
                run(0);
              } else {
                isPlayingRef.current = false;
                setIsPlaying(false);
                setCurrentLabel('idle');
              }
              return;
            }
            run(index + 1);
          },
          step.duration * 1000
        );
        timers.current.push(id);
      };

      run(0);
    },
    [clearTimers, playStep]
  );

  const handleVariantChange = (next: CueVariant) => {
    soundSynth.setCueVariant(next);
    setVariant(next);
  };

  const handleVolumeChange = (value: number) => {
    soundSynth.setVolume(value);
    setVolume(value);
  };

  const toggleAmbiance = () => {
    if (isAmbianceOn) {
      soundSynth.stopAmbiance(1.5);
      setIsAmbianceOn(false);
    } else {
      soundSynth.unlock();
      soundSynth.startAmbiance();
      setIsAmbianceOn(true);
    }
  };

  const toggleDrone = () => {
    if (isDroneOn) {
      soundSynth.stopDrone(1.5);
      setIsDroneOn(false);
    } else {
      soundSynth.unlock();
      soundSynth.startDrone();
      setIsDroneOn(true);
    }
  };

  const toggleMute = () => {
    const unmuted = soundSynth.toggleMute();
    setIsMuted(!unmuted);
  };

  const playSingle = (action: StepAction, duration: number) => {
    soundSynth.unlock();
    playStep({ action, duration });
    setCurrentLabel(ACTION_LABELS[action]);
    window.setTimeout(() => {
      if (!isPlayingRef.current) setCurrentLabel('idle');
    }, duration * 1000);
  };

  /**
   * Measures the real output level of each voice so the mix can be tuned against
   * numbers instead of impressions. Runs at full volume and restores the user's
   * own settings afterwards.
   */
  const runLevelReport = useCallback(async () => {
    const analyser = soundSynth.attachAnalyser();
    if (!analyser) {
      setLevelReport('AudioContext unavailable.');
      return;
    }
    if (soundSynth.getContextState() !== 'running') {
      setLevelReport(
        'AudioContext is suspended (browser autoplay policy).\n' +
          'Click anywhere on the page, then press "Measure output level" again.'
      );
      return;
    }

    const savedVolume = soundSynth.getVolume();
    const savedMuted = soundSynth.getIsMuted();
    const savedVariant = soundSynth.getCueVariant();

    setIsMeasuring(true);
    setLevelReport('Measuring...');
    soundSynth.stopBreathCue(0.1);
    soundSynth.stopAmbiance(0.2);
    soundSynth.stopDrone(0.2);
    soundSynth.setMuted(false);
    soundSynth.setVolume(1);

    const lines: string[] = ['Level report (slider at 100%)', ''];

    const measure = async (
      label: string,
      fire: () => void,
      windowMs: number,
      settleMs = 3000
    ) => {
      fire();
      await sleep(60);
      const { peak, rms } = await sampleLevel(analyser, windowMs);
      lines.push(
        `${label.padEnd(30)} peak ${toDb(peak).toFixed(1).padStart(6)} dBFS   rms ${toDb(rms)
          .toFixed(1)
          .padStart(6)} dBFS`
      );
      setLevelReport(lines.join('\n'));
      await sleep(settleMs);
    };

    // Ambient bed and drone settle in over 3s, so give them room before sampling.
    soundSynth.startAmbiance();
    soundSynth.startDrone();
    await sleep(3600);
    const bed = await sampleLevel(analyser, 1500);
    lines.push(
      `Ambient bed + drone (steady)    peak ${toDb(bed.peak)
        .toFixed(1)
        .padStart(6)} dBFS   rms ${toDb(bed.rms).toFixed(1).padStart(6)} dBFS`
    );
    setLevelReport(lines.join('\n'));

    soundSynth.stopAmbiance(0.3);
    soundSynth.stopDrone(0.3);
    await sleep(400);

    soundSynth.setCueVariant('surf');
    await measure('Breath noise (inhale 4s)', () => soundSynth.playInhaleCue(4), 1200);

    soundSynth.setCueVariant('bowl');
    await measure('Bowl bell + breath (inhale)', () => soundSynth.playInhaleCue(4), 1400);
    await measure('Bowl bell + hush (hold 7s)', () => soundSynth.playHoldCue(7), 1400);
    await measure('Bowl bell + breath (exhale)', () => soundSynth.playExhaleCue(8), 1400);
    await measure('Completion chime', () => soundSynth.playCompletionChime(), 1400);

    // Worst case: every voice at once.
    soundSynth.startAmbiance();
    soundSynth.startDrone();
    await sleep(3200);
    await measure(
      'WORST CASE (all voices at once)',
      () => {
        soundSynth.playInhaleCue(4);
        soundSynth.playCompletionChime();
      },
      2000,
      0
    );

    soundSynth.stopAmbiance(0.2);
    soundSynth.stopDrone(0.2);
    soundSynth.setCueVariant(savedVariant);
    soundSynth.setVolume(savedVolume);
    soundSynth.setMuted(savedMuted);
    setLevelReport(lines.join('\n'));
    setIsMeasuring(false);
  }, []);

  useEffect(() => {
    if (!window.location.search.includes('measure=1')) return;
    // Deferred so the browser has a chance to unlock the AudioContext first.
    const id = window.setTimeout(() => {
      void runLevelReport();
    }, 300);
    return () => window.clearTimeout(id);
  }, [runLevelReport]);

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200 px-5 py-8 max-w-xl mx-auto space-y-7">
      <header className="space-y-1">
        <h1 className="text-2xl font-serif-calm text-zinc-100">Audio Lab</h1>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Dev harness for the bedtime sound design. Press play, then pick the variant that
          sounds calmest to you. Use headphones and speaker to compare.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Cue variant</h2>
        <div className="grid gap-2">
          {VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() => handleVariantChange(v)}
              className={`text-left px-4 py-2.5 rounded-lg text-sm border transition-all cursor-pointer ${
                variant === v
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-zinc-100'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              {CUE_VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Full session</h2>
        {Object.entries(SEQUENCES).map(([key, sequence]) => (
          <div key={key} className="flex gap-2">
            <button
              onClick={() => playSequence(sequence.steps, 1)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-200 text-zinc-950 text-sm font-medium hover:bg-zinc-100 transition-colors cursor-pointer"
            >
              {sequence.label}
            </button>
            <button
              onClick={() => playSequence(sequence.steps, 3)}
              className="px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 transition-colors cursor-pointer"
            >
              x3
            </button>
          </div>
        ))}
        <button
          onClick={stop}
          disabled={!isPlaying}
          className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 disabled:opacity-30 transition-colors cursor-pointer"
        >
          Stop
        </button>
        <div className="text-center text-xs font-mono text-zinc-500 h-4">{currentLabel}</div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Single phase</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => playSingle('inhale', 4)}
            className="px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 transition-colors cursor-pointer"
          >
            Inhale 4s
          </button>
          <button
            onClick={() => playSingle('hold', 7)}
            className="px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 transition-colors cursor-pointer"
          >
            Hold 7s
          </button>
          <button
            onClick={() => playSingle('exhale', 8)}
            className="px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 transition-colors cursor-pointer"
          >
            Exhale 8s
          </button>
          <button
            onClick={() => {
              soundSynth.unlock();
              soundSynth.playCompletionChime();
              setCurrentLabel('Chime');
            }}
            className="px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 transition-colors cursor-pointer"
          >
            Completion chime
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Bed</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={toggleAmbiance}
            className={`px-4 py-2.5 rounded-lg border text-sm transition-colors cursor-pointer ${
              isAmbianceOn
                ? 'bg-indigo-500/15 border-indigo-500/40 text-zinc-100'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            Ambience {isAmbianceOn ? 'on' : 'off'}
          </button>
          <button
            onClick={toggleDrone}
            className={`px-4 py-2.5 rounded-lg border text-sm transition-colors cursor-pointer ${
              isDroneOn
                ? 'bg-indigo-500/15 border-indigo-500/40 text-zinc-100'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            Drone {isDroneOn ? 'on' : 'off'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Output</h2>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="volume-slider flex-1"
            aria-label="Volume"
          />
          <span className="text-xs font-mono text-zinc-500 w-10 text-right">
            {Math.round(volume * 100)}
          </span>
          <button
            onClick={toggleMute}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Level report</h2>
        <button
          onClick={() => void runLevelReport()}
          disabled={isMeasuring}
          className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 disabled:opacity-30 transition-colors cursor-pointer"
        >
          {isMeasuring ? 'Measuring...' : 'Measure output level'}
        </button>
        {levelReport && (
          <pre
            id="level-report"
            className="text-[11px] font-mono text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 overflow-x-auto whitespace-pre"
          >
            {levelReport}
          </pre>
        )}
      </section>
    </div>
  );
};

export default AudioLab;
