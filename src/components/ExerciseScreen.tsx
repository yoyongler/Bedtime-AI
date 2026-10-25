import React, { useState, useEffect, useRef } from 'react';
import type { ExerciseConfig, ExercisePhase } from '../types';
import { soundSynth } from '../utils/audio';

interface ExerciseScreenProps {
  exercise: ExerciseConfig;
  totalDurationSeconds: number;
  onComplete: () => void;
  onExitEarly: () => void;
}

export const ExerciseScreen: React.FC<ExerciseScreenProps> = ({
  exercise,
  totalDurationSeconds,
  onComplete,
  onExitEarly,
}) => {
  const [isSettling, setIsSettling] = useState<boolean>(true);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const phases = exercise.phases;
  const cycleTotalSeconds = phases.reduce((acc, p) => acc + p.durationSeconds, 0);

  const isAmber = exercise.id === 'physiological-sigh';
  const previousPhaseIndexRef = useRef<number>(-1);
  const wakeLockRef = useRef<any>(null);

  // Derived: the session is closing out once the full duration has elapsed.
  const isFinishing = elapsedSeconds >= totalDurationSeconds && !isSettling;
  const hasChimedRef = useRef<boolean>(false);

  // 1.5-second Settling Phase before exercise begins
  useEffect(() => {
    const settlingTimer = window.setTimeout(() => {
      setIsSettling(false);
    }, 1500);

    return () => window.clearTimeout(settlingTimer);
  }, []);

  // Screen Wake Lock API (keeps screen awake during bedtime exercises)
  useEffect(() => {
    let isMounted = true;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          const lock = await (navigator as any).wakeLock.request('screen');
          if (isMounted) {
            wakeLockRef.current = lock;
          } else {
            lock.release();
          }
        }
      } catch {
        // Safe fail on devices/browsers that restrict wakeLock
      }
    };

    requestWakeLock();

    return () => {
      isMounted = false;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // Stop the breath cue when pausing. Clearing the phase index means the cue
  // re-strikes for the current phase when the session resumes.
  useEffect(() => {
    if (isPaused) {
      soundSynth.stopBreathCue(0.3);
      previousPhaseIndexRef.current = -1;
    }
  }, [isPaused]);

  useEffect(() => {
    return () => {
      soundSynth.stopBreathCue(0.2);
    };
  }, []);

  // Keyboard listener: Escape to exit, Space to pause/resume
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundSynth.stopBreathCue(0.2);
        onExitEarly();
      } else if (e.code === 'Space' && !isSettling && !isFinishing) {
        e.preventDefault();
        setIsPaused((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExitEarly, isSettling, isFinishing]);

  // Master timer (only ticks when not settling and not paused)
  useEffect(() => {
    if (isSettling || isPaused || isFinishing) return;

    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= totalDurationSeconds) {
          window.clearInterval(timer);
          return totalDurationSeconds;
        }
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isSettling, isPaused, isFinishing, totalDurationSeconds]);

  // Derive active phase and remaining phase seconds from elapsed time
  const secondInCycle = elapsedSeconds % cycleTotalSeconds;

  let accumulated = 0;
  let activePhaseIndex = 0;
  let phaseSecondsLeft = phases[0].durationSeconds;

  for (let i = 0; i < phases.length; i++) {
    const phaseDuration = phases[i].durationSeconds;
    if (secondInCycle < accumulated + phaseDuration) {
      activePhaseIndex = i;
      const secondsIntoPhase = secondInCycle - accumulated;
      phaseSecondsLeft = phaseDuration - secondsIntoPhase;
      break;
    }
    accumulated += phaseDuration;
  }

  const currentPhase: ExercisePhase = phases[activePhaseIndex];

  // Play audio guidance cues on each phase transition:
  // - Inhale: bowl bell strike + rising breath noise
  // - Hold: lower bell that rings out for the length of the hold
  // - Exhale: low bell strike + falling breath noise
  useEffect(() => {
    if (!isSettling && !isPaused && previousPhaseIndexRef.current !== activePhaseIndex && !isFinishing) {
      previousPhaseIndexRef.current = activePhaseIndex;

      if (currentPhase.action === 'expand') {
        // The physiological sigh has a smaller second sip, so it gets a softer,
        // lower bell and a brighter (but shorter) noise swell.
        if (currentPhase.name === 'inhale-2') {
          soundSynth.playInhaleCue(currentPhase.durationSeconds, 'topup');
        } else {
          soundSynth.playInhaleCue(currentPhase.durationSeconds);
        }
      } else if (currentPhase.action === 'hold') {
        soundSynth.playHoldCue(currentPhase.durationSeconds);
      } else if (currentPhase.action === 'contract') {
        soundSynth.playExhaleCue(currentPhase.durationSeconds);
      }
    }
  }, [activePhaseIndex, currentPhase, isSettling, isPaused, isFinishing]);

  // Completion trigger: play the closing bowl chime, gently fade out the ring,
  // then transition to the completion screen.
  useEffect(() => {
    if (!isFinishing || hasChimedRef.current) return;
    hasChimedRef.current = true;

    soundSynth.playCompletionChime();

    const timer = window.setTimeout(() => {
      onComplete();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isFinishing, onComplete]);

  const secondsRemaining = Math.max(0, totalDurationSeconds - elapsedSeconds);
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Breathing Ring scale and transition timing.
  // Pausing deliberately does NOT shorten the transition: the ring finishes easing
  // to the phase target and then holds, instead of snapping.
  const activeScale = isSettling ? 0.8 : currentPhase.scale;
  const transitionDurationSecs =
    isSettling || currentPhase.action === 'hold' ? 0.05 : currentPhase.durationSeconds;

  const handleContainerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (!isSettling && !isFinishing) {
      setIsPaused((prev) => !prev);
    }
  };

  return (
    <div
      onClick={handleContainerClick}
      className={`relative min-h-screen bg-[#050505] text-zinc-200 flex flex-col items-center justify-between py-12 px-6 select-none overflow-hidden transition-all duration-1000 ease-in-out cursor-default ${
        isFinishing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      {/* Background ambient glow that gently pulses with breath scale */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl pointer-events-none transition-all ${
          isAmber ? 'bg-amber-500/10' : 'bg-indigo-500/10'
        }`}
        style={{
          transform: `translate(-50%, -50%) scale(${activeScale * 1.1})`,
          transitionDuration: `${transitionDurationSecs}s`,
          transitionTimingFunction: 'cubic-bezier(0.35, 0, 0.25, 1)',
        }}
      />

      {/* Top subtle utility bar */}
      <div className="w-full max-w-sm flex items-center justify-between text-xs text-zinc-600 relative z-10">
        <span className="font-light tracking-wider uppercase text-[10px] text-zinc-500">
          {exercise.title}
        </span>
        <button
          onClick={() => {
            soundSynth.stopBreathCue(0.2);
            onExitEarly();
          }}
          tabIndex={-1}
          aria-label="Exit exercise"
          className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors cursor-pointer"
        >
          Exit
        </button>
      </div>

      {/* Breathing Ring visual element */}
      <div className="relative my-auto flex items-center justify-center">
        {/* Soft glowing ambient aura behind the ring */}
        <div
          className={`absolute w-64 h-64 rounded-full blur-2xl pointer-events-none transition-all ${
            isAmber ? 'bg-amber-500/20' : 'bg-indigo-500/20'
          }`}
          style={{
            transform: `scale(${activeScale * 1.12})`,
            opacity: isSettling ? 0.5 : currentPhase.opacity * 0.85,
            transitionDuration: `${transitionDurationSecs}s`,
            transitionTimingFunction: 'cubic-bezier(0.35, 0, 0.25, 1)',
          }}
        />

        {/* Dynamic Breathing Ring */}
        <div
          className={`relative w-64 h-64 rounded-full border-2 flex items-center justify-center transition-all ${
            isAmber
              ? currentPhase.action === 'hold' && !isSettling
                ? 'border-amber-300/50 shadow-[0_0_24px_rgba(245,158,11,0.25)]'
                : 'border-amber-400/35'
              : currentPhase.action === 'hold' && !isSettling
              ? 'border-indigo-300/50 shadow-[0_0_24px_rgba(99,102,241,0.25)]'
              : 'border-indigo-400/35'
          }`}
          style={{
            transform: `scale(${activeScale})`,
            transitionDuration: `${transitionDurationSecs}s`,
            transitionTimingFunction: 'cubic-bezier(0.35, 0, 0.25, 1)',
          }}
        >
          {/* Soft inner glow core disc in the middle of the ring */}
          <div
            className={`w-36 h-36 rounded-full blur-md transition-all ${
              isAmber
                ? 'bg-gradient-to-tr from-amber-500/20 via-amber-400/25 to-orange-400/20'
                : 'bg-gradient-to-tr from-indigo-500/25 via-indigo-400/25 to-purple-500/20'
            }`}
            style={{
              opacity: isSettling ? 0.4 : currentPhase.opacity,
              transitionDuration: `${transitionDurationSecs}s`,
              transitionTimingFunction: 'cubic-bezier(0.35, 0, 0.25, 1)',
            }}
          />

          {/* Center Display: "Let's begin." during settling, countdown during active exercise */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
            {isSettling ? (
              <span className="text-xl sm:text-2xl font-serif-calm text-zinc-200 tracking-wide font-normal animate-soft-fade">
                Let&rsquo;s begin.
              </span>
            ) : isPaused ? (
              <span className="text-sm font-light text-zinc-400 tracking-wider">
                Paused
              </span>
            ) : (
              <span className="text-3xl font-light text-zinc-300 font-mono tracking-tight tabular-nums opacity-80">
                {phaseSecondsLeft}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Informative Text & Instructions Display */}
      <div className="w-full max-w-sm text-center space-y-2 relative z-10 min-h-[5.5rem] flex flex-col justify-end">
        {isSettling ? (
          <div className="animate-soft-fade space-y-1">
            <h2 className="text-2xl font-light text-zinc-100 font-serif-calm tracking-wide">
              Settle in
            </h2>
            <p className="text-xs text-zinc-400 font-light tracking-wide">
              Relax your shoulders and close your lips
            </p>
          </div>
        ) : isPaused ? (
          <div className="space-y-1">
            <h2 className="text-2xl font-light text-zinc-200 font-serif-calm tracking-wide">
              Paused
            </h2>
            <p className="text-xs text-zinc-400 font-light tracking-wide">
              Tap anywhere to resume
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-light text-zinc-100 font-serif-calm tracking-wide">
              {currentPhase.label}
            </h2>
            <p className="text-xs text-zinc-400 font-light tracking-wide">
              {currentPhase.instruction}
            </p>
          </>
        )}

        {/* Overall time remaining */}
        <div className="pt-2">
          <span className="text-[11px] font-mono text-zinc-600 tracking-wider">
            {formatTime(secondsRemaining)} remaining
          </span>
        </div>
      </div>
    </div>
  );
};
