/**
 * Gentle Web Audio synthesizer for bedtime soothing ambiance and exercise audio cues.
 * Browser-native using AudioContext: zero external audio files or APIs required.
 *
 * Sound design
 * ------------
 * The earlier version drove the phases with a single continuous sine oscillator whose
 * pitch glided between 220Hz and 330Hz. A sustained pure sine is harsh and the rising
 * glide reads as "alerting", so the whole thing sounded like an alarm.
 *
 * This version builds the cues from three layered voices instead:
 *
 *  1. Bowl voice - a struck bell built from *inharmonic* partials (ratios 1, 2.76, 5.40,
 *     8.93) with a fast attack and a per-partial exponential decay. The inharmonicity is
 *     what makes it read as a chime rather than a beep. Pitch carries the phase:
 *     inhale = E4, hold = B3, exhale = G3, a G major triad so the cycle stays consonant.
 *
 *  2. Breath noise - bandpass filtered noise swept upward on inhale and downward on
 *     exhale, shaped with a swell envelope. It is literally airflow, so it maps to the
 *     length of the phase without being a tone. The hold is a very quiet hush.
 *
 *  3. Drone - two slightly detuned low sines that bed the whole session so the hold
 *     phase is never dead silence.
 *
 * Everything is fed through a generated convolution impulse response. A real reverb
 * tail is the single biggest contributor to the "soft" quality; the previous feedback
 * delay comb was metallic and rang like a cheap bell.
 */

export type CueVariant = 'bowl' | 'glass' | 'surf' | 'drone' | 'legacy';
export type CueIntensity = 'full' | 'topup';

export const CUE_VARIANT_LABELS: Record<CueVariant, string> = {
  bowl: 'Bowl bell + breath (recommended)',
  glass: 'Glass bell + breath',
  surf: 'Surf only (no bells)',
  drone: 'Low drone sweep only',
  legacy: 'Legacy tone (for comparison)',
};

interface PartialSpec {
  ratio: number;
  gain: number;
  decay: number;
}

interface VoiceConfig {
  partials: PartialSpec[];
  decaySeconds: number;
  peak: number;
  dry: number;
  wet: number;
}

/** Warm singing-bowl: low, round, long decay. */
const BOWL_VOICE: VoiceConfig = {
  partials: [
    { ratio: 1.0, gain: 1.0, decay: 1.0 },
    { ratio: 2.76, gain: 0.3, decay: 0.58 },
    { ratio: 5.4, gain: 0.12, decay: 0.34 },
    { ratio: 8.93, gain: 0.045, decay: 0.2 },
  ],
  decaySeconds: 2.4,
  peak: 0.024,
  dry: 0.5,
  wet: 0.95,
};

/** Brighter glass: higher partials, shorter ring. */
const GLASS_VOICE: VoiceConfig = {
  partials: [
    { ratio: 1.0, gain: 1.0, decay: 1.0 },
    { ratio: 2.0, gain: 0.42, decay: 0.62 },
    { ratio: 3.01, gain: 0.2, decay: 0.42 },
    { ratio: 4.21, gain: 0.09, decay: 0.26 },
  ],
  decaySeconds: 1.7,
  peak: 0.02,
  dry: 0.45,
  wet: 0.8,
};

/** Phase pitches: a G major triad, so the cycle is always consonant. */
const PITCH_INHALE = 329.63; // E4
const PITCH_TOPUP = 293.66; // D4  (the smaller second sip of a physiological sigh)
const PITCH_HOLD = 246.94; // B3
const PITCH_EXHALE = 196.0; // G3

const EPS = 0.0001;

/**
 * Master output trim applied to every voice at the routing stage.
 *
 * The voices were originally authored at levels that sat around -40 dBFS once the
 * reverb tail and the 0.8 master trim were accounted for, which is why the session
 * was effectively inaudible without turning the device volume all the way up.
 * This single constant scales the whole mix by a fixed amount, so the balance
 * between the bell, the breath noise, the ambient bed and the drone is preserved.
 */
const OUTPUT_GAIN = 8;

/** Default slider position. Comfortably audible, with headroom above it. */
const DEFAULT_VOLUME = 0.7;

const STORAGE_VOLUME_KEY = 'bedtime_volume';
const STORAGE_MUTED_KEY = 'bedtime_muted';

class BedtimeSoundSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private reverbSend: GainNode | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;

  private isMuted = false;
  private masterVolume = DEFAULT_VOLUME;
  private cueVariant: CueVariant = 'bowl';
  private persistTimer: number | null = null;

  private activeCueGains = new Set<GainNode>();
  private activeSources = new Set<AudioScheduledSourceNode>();
  private activeCueSources = new Set<AudioScheduledSourceNode>();

  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOscs: OscillatorNode[] = [];

  private noiseNode: AudioBufferSourceNode | null = null;
  private noiseGainNode: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseLfo: OscillatorNode | null = null;
  private noiseLfoGain: GainNode | null = null;

  // ---------------------------------------------------------------- graph ---

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      this.ctx = new AudioContextClass();
      this.buildGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private buildGraph(ctx: AudioContext) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.isMuted ? EPS : Math.max(this.masterVolume, EPS);

    // Safety limiter. It sits below the normal working level so it stays out of
    // the way, but it catches the sum of bell + breath noise + bed + chime at the
    // top of the slider and prevents digital clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.25;

    this.masterGain.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.createImpulseResponse(ctx, 2.6, 2.8);

    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 1;
    convolver.connect(reverbReturn);
    reverbReturn.connect(this.masterGain);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(convolver);

    this.whiteNoiseBuffer = this.createWhiteNoiseBuffer(ctx, 3);
  }

  /**
   * Exponentially decaying stereo noise used as a convolution impulse response.
   * A real reverb tail is what makes the bells feel spacious rather than dry.
   */
  private createImpulseResponse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const buffer = ctx.createBuffer(2, length, rate);
    const preDelay = Math.floor(rate * 0.02);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        if (i < preDelay) {
          data[i] = 0;
          continue;
        }
        const t = (i - preDelay) / (length - preDelay);
        const envelope = Math.pow(1 - t, decay);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
      // One-pole lowpass to keep the tail dark and soft.
      let previous = 0;
      for (let i = 0; i < length; i++) {
        previous = previous * 0.62 + data[i] * 0.38;
        data[i] = previous;
      }
    }

    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createBrownNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 1.4;
    }
    return buffer;
  }

  /** Routes a voice to the dry master path and the reverb send at independent levels. */
  private routeVoice(node: AudioNode, dry: number, wet: number) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain || !this.reverbSend) return;
    if (dry > 0) {
      const dryGain = ctx.createGain();
      dryGain.gain.value = dry * OUTPUT_GAIN;
      node.connect(dryGain);
      dryGain.connect(this.masterGain);
    }
    if (wet > 0) {
      const wetGain = ctx.createGain();
      wetGain.gain.value = wet * OUTPUT_GAIN;
      node.connect(wetGain);
      wetGain.connect(this.reverbSend);
    }
  }

  private trackSource(source: AudioScheduledSourceNode, onEnd?: () => void, isCue = false) {
    this.activeSources.add(source);
    if (isCue) {
      this.activeCueSources.add(source);
    }
    source.onended = () => {
      this.activeSources.delete(source);
      this.activeCueSources.delete(source);
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      onEnd?.();
    };
  }

  // ------------------------------------------------------------- controls ---

  constructor() {
    this.masterVolume = this.readStoredVolume(DEFAULT_VOLUME);
    this.isMuted = this.readStoredBoolean(STORAGE_MUTED_KEY, false);
  }

  private readStoredVolume(fallback: number): number {
    try {
      const raw = localStorage.getItem(STORAGE_VOLUME_KEY);
      if (raw === null) return fallback;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(1, Math.max(0, parsed));
    } catch {
      return fallback;
    }
  }

  private readStoredBoolean(key: string, fallback: boolean): boolean {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === '1';
    } catch {
      return fallback;
    }
  }

  /** Debounced so dragging the slider does not thrash localStorage. */
  private persist(key: string, value: string) {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage may be unavailable; the setting just will not survive a reload.
      }
    }, 150);
  }

  /**
   * Must be called from inside a user gesture (a click) so mobile browsers allow
   * the AudioContext to start. Calling it later, from an effect, is too late.
   */
  public unlock() {
    this.initContext();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return !this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    this.applyMasterVolume(0.25);
    this.persist(STORAGE_MUTED_KEY, muted ? '1' : '0');
  }

  public setVolume(volume: number) {
    this.masterVolume = Math.min(1, Math.max(0, volume));
    this.applyMasterVolume(0.08);
    this.persist(STORAGE_VOLUME_KEY, String(this.masterVolume));
  }

  public getVolume(): number {
    return this.masterVolume;
  }

  public setCueVariant(variant: CueVariant) {
    this.cueVariant = variant;
  }

  public getCueVariant(): CueVariant {
    return this.cueVariant;
  }

  /** 'running' only once the browser has allowed audio to actually start. */
  public getContextState(): AudioContextState | 'uninitialised' {
    return this.ctx ? this.ctx.state : 'uninitialised';
  }

  /**
   * Dev helper: taps the final output (after the limiter) so levels can be
   * measured objectively instead of guessed at.
   */
  public attachAnalyser(): AnalyserNode | null {
    const ctx = this.initContext();
    if (!ctx || !this.limiter) return null;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.limiter.connect(this.analyser);
    }
    return this.analyser;
  }

  private applyMasterVolume(fadeSeconds = 0.05) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const target = this.isMuted ? EPS : Math.max(this.masterVolume, EPS);
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(Math.max(this.masterGain.gain.value, EPS), now);
    this.masterGain.gain.linearRampToValueAtTime(target, now + fadeSeconds);
  }

  /** Stops every sounding voice and silences the master path. */
  public stopAll(fadeSeconds = 0.25) {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(Math.max(this.masterGain.gain.value, EPS), now);
    this.masterGain.gain.exponentialRampToValueAtTime(EPS, now + fadeSeconds);

    window.setTimeout(() => {
      this.activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // already stopped
        }
      });
      this.activeSources.clear();
      this.activeCueGains.clear();
      this.stopDrone(0.05);
      this.stopAmbiance(0.05);
      this.applyMasterVolume(0.05);
    }, fadeSeconds * 1000 + 60);
  }

  /**
   * Fades out whatever breath cue is currently sounding without touching the
   * ambient bed, the drone, or the closing chime.
   */
  public stopBreathCue(fadeSeconds = 0.3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.activeCueGains.forEach((gain) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, EPS), now);
        gain.gain.exponentialRampToValueAtTime(EPS, now + fadeSeconds);
      } catch {
        // node already finished
      }
    });
    window.setTimeout(
      () => {
        this.activeCueSources.forEach((source) => {
          try {
            source.stop();
          } catch {
            // already stopped
          }
        });
        this.activeCueSources.clear();
        this.activeCueGains.clear();
      },
      fadeSeconds * 1000 + 40
    );
  }

  // ------------------------------------------------------------- ambience ---

  /** Soft low bed with a slow swell, so the room never feels dead. */
  public startAmbiance() {
    const ctx = this.initContext();
    if (!ctx || this.noiseNode) return;

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.createBrownNoiseBuffer(ctx, 4);
    source.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 45;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 800;
    lowpass.Q.value = 0.4;

    // Very slow LFO opening and closing the cutoff: the bed breathes.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);
    lfo.start(now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(EPS, now);
    gain.gain.linearRampToValueAtTime(0.016, now + 3);

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gain);
    this.routeVoice(gain, 1, 0.1);

    source.start(now);
    this.noiseNode = source;
    this.noiseGainNode = gain;
    this.noiseFilter = lowpass;
    this.noiseLfo = lfo;
    this.noiseLfoGain = lfoGain;
  }

  public stopAmbiance(fadeSeconds = 2.0) {
    const ctx = this.ctx;
    const gain = this.noiseGainNode;
    const source = this.noiseNode;
    const lfo = this.noiseLfo;
    const lfoGain = this.noiseLfoGain;
    const filter = this.noiseFilter;

    // Cleared up front so a following startAmbiance() is not blocked by the
    // pending fade-out, and so the bed can be restarted immediately.
    this.noiseNode = null;
    this.noiseGainNode = null;
    this.noiseFilter = null;
    this.noiseLfo = null;
    this.noiseLfoGain = null;

    if (gain && ctx) {
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, EPS), now);
        gain.gain.exponentialRampToValueAtTime(EPS, now + fadeSeconds);
      } catch {
        // node already finished
      }
    }

    window.setTimeout(
      () => {
        try {
          source?.stop();
        } catch {
          // already stopped
        }
        try {
          lfo?.stop();
        } catch {
          // already stopped
        }
        try {
          source?.disconnect();
        } catch {
          // already disconnected
        }
        try {
          lfo?.disconnect();
        } catch {
          // already disconnected
        }
        try {
          lfoGain?.disconnect();
        } catch {
          // already disconnected
        }
        try {
          filter?.disconnect();
        } catch {
          // already disconnected
        }
      },
      fadeSeconds * 1000 + 100
    );
  }

  // ---------------------------------------------------------------- drone ---

  /** Two detuned low sines: a warm bed under the whole session. */
  public startDrone() {
    const ctx = this.initContext();
    if (!ctx || this.droneGain) return;

    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(EPS, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 3);

    const oscillators = [98, 98.65].map((frequency) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(gain);
    this.routeVoice(gain, 1, 0.15);

    this.droneGain = gain;
    this.droneFilter = filter;
    this.droneOscs = oscillators;
  }

  public stopDrone(fadeSeconds = 2.0) {
    const ctx = this.ctx;
    const gain = this.droneGain;
    const oscillators = this.droneOscs;
    const filter = this.droneFilter;

    // Cleared up front so the drone can be restarted straight away.
    this.droneGain = null;
    this.droneFilter = null;
    this.droneOscs = [];

    if (gain && ctx) {
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, EPS), now);
        gain.gain.exponentialRampToValueAtTime(EPS, now + fadeSeconds);
      } catch {
        // node already finished
      }
    }

    window.setTimeout(
      () => {
        oscillators.forEach((osc) => {
          try {
            osc.stop();
          } catch {
            // already stopped
          }
          try {
            osc.disconnect();
          } catch {
            // already disconnected
          }
        });
        try {
          filter?.disconnect();
        } catch {
          // already disconnected
        }
      },
      fadeSeconds * 1000 + 100
    );
  }

  /** Sweeps the drone's lowpass up on inhale and down on exhale. */
  private playDroneSweep(direction: 'inhale' | 'hold' | 'exhale', durationSeconds: number) {
    const ctx = this.initContext();
    if (!ctx) return;
    this.startDrone();
    const filter = this.droneFilter;
    if (!filter) return;

    const now = ctx.currentTime;
    const dur = Math.max(0.3, durationSeconds);
    filter.frequency.cancelScheduledValues(now);
    if (direction === 'inhale') {
      filter.frequency.setValueAtTime(240, now);
      filter.frequency.exponentialRampToValueAtTime(900, now + dur * 0.9);
    } else if (direction === 'exhale') {
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + dur * 0.95);
    } else {
      filter.frequency.setValueAtTime(340, now);
    }
  }

  // --------------------------------------------------------------- voices ---

  /** Strikes a single bell: one oscillator per inharmonic partial. */
  private strikeBell(
    frequency: number,
    decay: number,
    peak: number,
    config: VoiceConfig,
    trackAsCue = true
  ) {
    const ctx = this.initContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const stopAt = now + decay + 0.3;

    config.partials.forEach((partial) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency * partial.ratio, now);

      const gain = ctx.createGain();
      const partialDecay = Math.max(0.25, decay * partial.decay);
      const partialPeak = Math.max(peak * partial.gain, EPS);
      gain.gain.setValueAtTime(EPS, now);
      gain.gain.linearRampToValueAtTime(partialPeak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(EPS, now + partialDecay);

      osc.connect(gain);
      this.routeVoice(gain, config.dry, config.wet);

      if (trackAsCue) {
        this.activeCueGains.add(gain);
      }
      osc.start(now);
      osc.stop(stopAt);
      this.trackSource(
        osc,
        () => {
          this.activeCueGains.delete(gain);
          try {
            gain.disconnect();
          } catch {
            // already disconnected
          }
        },
        trackAsCue
      );
    });
  }

  /**
   * The bowl bell that marks a phase change. On the hold, the bell's decay is the
   * hold: it rings out for the full length of the phase.
   */
  private playBowlCue(
    durationSeconds: number,
    direction: 'inhale' | 'hold' | 'exhale',
    timbre: 'bowl' | 'glass',
    intensity: CueIntensity = 'full'
  ) {
    const config = timbre === 'glass' ? GLASS_VOICE : BOWL_VOICE;
    const topup = intensity === 'topup';

    const frequency =
      direction === 'inhale'
        ? topup
          ? PITCH_TOPUP
          : PITCH_INHALE
        : direction === 'hold'
          ? PITCH_HOLD
          : PITCH_EXHALE;

    const decay =
      direction === 'hold'
        ? Math.max(1.2, Math.min(durationSeconds, 7.5))
        : Math.max(1.1, Math.min(config.decaySeconds, durationSeconds * 1.4 + 0.8));

    const peak =
      config.peak * (topup ? 0.6 : 1) * (direction === 'exhale' ? 0.92 : 1);

    this.strikeBell(frequency, decay, peak, config);
  }

  /**
   * Bandpassed noise that breathes with the phase: rising on inhale, falling on
   * exhale, a very quiet hush on hold.
   */
  private playBreathSwell(
    direction: 'inhale' | 'hold' | 'exhale',
    durationSeconds: number,
    intensity: CueIntensity = 'full'
  ) {
    const ctx = this.initContext();
    if (!ctx || !this.whiteNoiseBuffer) return;

    const now = ctx.currentTime;
    const dur = Math.max(0.3, durationSeconds);
    const topup = intensity === 'topup';

    const source = ctx.createBufferSource();
    source.buffer = this.whiteNoiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    const peak = direction === 'hold' ? 0.0035 : topup ? 0.006 : 0.011;

    if (direction === 'inhale') {
      filter.frequency.setValueAtTime(450, now);
      filter.frequency.exponentialRampToValueAtTime(topup ? 1900 : 1500, now + dur * 0.9);
      gain.gain.setValueAtTime(EPS, now);
      gain.gain.linearRampToValueAtTime(peak, now + dur * 0.55);
      gain.gain.exponentialRampToValueAtTime(EPS, now + dur * 0.98);
    } else if (direction === 'exhale') {
      filter.frequency.setValueAtTime(1500, now);
      filter.frequency.exponentialRampToValueAtTime(380, now + dur * 0.95);
      gain.gain.setValueAtTime(EPS, now);
      gain.gain.linearRampToValueAtTime(peak, now + dur * 0.3);
      gain.gain.exponentialRampToValueAtTime(EPS, now + dur * 0.98);
    } else {
      filter.frequency.setValueAtTime(1100, now);
      gain.gain.setValueAtTime(EPS, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.6);
      gain.gain.setValueAtTime(peak, now + dur * 0.6);
      gain.gain.exponentialRampToValueAtTime(EPS, now + dur);
    }

    source.connect(filter);
    filter.connect(gain);
    this.routeVoice(gain, 0.9, 0.3);

    this.activeCueGains.add(gain);
    source.start(now);
    source.stop(now + dur + 0.15);
    this.trackSource(
      source,
      () => {
        this.activeCueGains.delete(gain);
        try {
          filter.disconnect();
        } catch {
          // already disconnected
        }
        try {
          gain.disconnect();
        } catch {
          // already disconnected
        }
      },
      true
    );
  }

  /**
   * The original implementation, kept only so the audition lab can A/B against it.
   * One oscillator per phase rather than the old persistent one, but the same
   * frequencies, envelopes and levels.
   */
  private playLegacyCue(
    direction: 'inhale' | 'hold' | 'exhale',
    durationSeconds: number
  ) {
    const ctx = this.initContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = Math.max(0.3, durationSeconds);

    const osc = ctx.createOscillator();
    osc.type = 'sine';

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(EPS, now);

    if (direction === 'inhale') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(330, now + dur);
      gain.gain.linearRampToValueAtTime(0.045, now + Math.min(0.8, dur * 0.4));
      gain.gain.setValueAtTime(0.045, now + dur);
    } else if (direction === 'hold') {
      osc.frequency.setValueAtTime(330, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.3);
      gain.gain.setValueAtTime(0.035, now + dur);
    } else {
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.linearRampToValueAtTime(220, now + dur * 0.85);
      gain.gain.linearRampToValueAtTime(0.038, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(EPS, now + dur);
    }

    osc.connect(gain);
    this.routeVoice(gain, 1, 0);

    this.activeCueGains.add(gain);
    osc.start(now);
    osc.stop(now + dur + 0.2);
    this.trackSource(
      osc,
      () => {
        this.activeCueGains.delete(gain);
        try {
          gain.disconnect();
        } catch {
          // already disconnected
        }
      },
      true
    );
  }

  // ------------------------------------------------------------ phase cues ---

  public playInhaleCue(durationSeconds: number, intensity: CueIntensity = 'full') {
    const dur = Math.max(0.3, durationSeconds);
    switch (this.cueVariant) {
      case 'legacy':
        return this.playLegacyCue('inhale', dur);
      case 'surf':
        return this.playBreathSwell('inhale', dur, intensity);
      case 'drone':
        return this.playDroneSweep('inhale', dur);
      case 'glass':
        this.playBowlCue(dur, 'inhale', 'glass', intensity);
        this.playBreathSwell('inhale', dur, intensity);
        return;
      case 'bowl':
      default:
        this.playBowlCue(dur, 'inhale', 'bowl', intensity);
        this.playBreathSwell('inhale', dur, intensity);
        return;
    }
  }

  public playHoldCue(durationSeconds: number) {
    const dur = Math.max(0.3, durationSeconds);
    switch (this.cueVariant) {
      case 'legacy':
        return this.playLegacyCue('hold', dur);
      case 'surf':
        return this.playBreathSwell('hold', dur);
      case 'drone':
        return this.playDroneSweep('hold', dur);
      case 'glass':
        this.playBowlCue(dur, 'hold', 'glass');
        this.playBreathSwell('hold', dur);
        return;
      case 'bowl':
      default:
        this.playBowlCue(dur, 'hold', 'bowl');
        this.playBreathSwell('hold', dur);
        return;
    }
  }

  public playExhaleCue(durationSeconds: number) {
    const dur = Math.max(0.3, durationSeconds);
    switch (this.cueVariant) {
      case 'legacy':
        return this.playLegacyCue('exhale', dur);
      case 'surf':
        return this.playBreathSwell('exhale', dur);
      case 'drone':
        return this.playDroneSweep('exhale', dur);
      case 'glass':
        this.playBowlCue(dur, 'exhale', 'glass');
        this.playBreathSwell('exhale', dur);
        return;
      case 'bowl':
      default:
        this.playBowlCue(dur, 'exhale', 'bowl');
        this.playBreathSwell('exhale', dur);
        return;
    }
  }

  /** A long, low bowl strike to close the session. */
  public playCompletionChime() {
    this.stopDrone(3);
    // Not tracked as a breath cue: the session ends while the chime is still
    // ringing, and the screen teardown must not cut it off.
    this.strikeBell(PITCH_EXHALE, 6, 0.03, BOWL_VOICE, false);
    window.setTimeout(() => {
      this.strikeBell(PITCH_TOPUP, 4.5, 0.016, BOWL_VOICE, false);
    }, 2200);
  }

  /** Soft short bell, used for interface transitions. */
  public playTransitionChime() {
    this.strikeBell(PITCH_HOLD, 1.2, 0.014, GLASS_VOICE);
  }
}

export const soundSynth = new BedtimeSoundSynth();
