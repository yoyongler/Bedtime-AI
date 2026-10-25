import React from 'react';
import { Key } from 'lucide-react';
import type { ExerciseType } from '../types';
import { VolumeControl } from './VolumeControl';

interface HomeScreenProps {
  onSelectOption: (type: ExerciseType) => void;
  isQuickTestMode: boolean;
  onToggleQuickTest: () => void;
  volume: number;
  isMuted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onOpenApiKeyModal: () => void;
  hasCustomKey: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectOption,
  isQuickTestMode,
  onToggleQuickTest,
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
  onOpenApiKeyModal,
  hasCustomKey,
}) => {
  return (
    <div className="relative min-h-screen bg-[#050505] text-zinc-200 flex flex-col justify-between px-6 py-10 max-w-lg mx-auto overflow-hidden">
      {/* Soft background ambient glow */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-96 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      {/* Top Bar: Minimal utility icons */}
      <header className="flex items-center justify-end gap-2 relative z-10">
        <VolumeControl
          volume={volume}
          isMuted={isMuted}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
        />

        <button
          onClick={onOpenApiKeyModal}
          aria-label="API Settings"
          title="Configure API key"
          className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors relative cursor-pointer"
        >
          <Key className="w-4 h-4" />
          {hasCustomKey && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-zinc-400 rounded-full" />
          )}
        </button>
      </header>

      {/* Main Selection Area */}
      <main className="my-auto py-6 relative z-10">
        <h1 className="text-3xl font-serif-calm text-zinc-100 text-center mb-8">
          Unwind for the night
        </h1>

        <div className="space-y-3">

          {/* Option 3: Unload & Breathe */}
          <button
            onClick={() => onSelectOption('mind-dump')}
            className="w-full text-left p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-teal-500/30 hover:shadow-[0_0_30px_rgba(20,184,166,0.06)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <h2 className="text-base font-medium text-zinc-200">
                Unload &amp; Breathe
              </h2>
              <span className="text-xs text-zinc-500 font-mono">
                Mind Dump
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-1.5">
              Write down one thought, let us put it to rest
            </p>
            <p className="text-[11px] text-zinc-500 font-mono">
              Calm Reassurance &middot; 4-7-8 Breathing
            </p>
          </button>

          {/* Option 1: 4-7-8 Deep Sleep */}
          <button
            onClick={() => onSelectOption('4-7-8')}
            className="w-full text-left p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-indigo-500/30 hover:shadow-[0_0_30px_rgba(99,102,241,0.06)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <h2 className="text-base font-medium text-zinc-200">
                Deep Sleep
              </h2>
              <span className="text-xs text-zinc-500 font-mono">
                {isQuickTestMode ? '30s preview' : '5 mins'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-1.5">
              Long exhales to quiet a busy mind
            </p>
            <p className="text-[11px] text-zinc-500 font-mono">
              4-7-8 Breathing &middot; 4s in &middot; 7s hold &middot; 8s out
            </p>
          </button>

          {/* Option 2: Physiological Sigh */}
          <button
            onClick={() => onSelectOption('physiological-sigh')}
            className="w-full text-left p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.06)] transition-all duration-300 cursor-pointer"
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <h2 className="text-base font-medium text-zinc-200">
                Quick break
              </h2>
              <span className="text-xs text-zinc-500 font-mono">
                {isQuickTestMode ? '30s preview' : '3 mins'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-1.5">
              Two quick inhales, one long sigh to drop tension
            </p>
            <p className="text-[11px] text-zinc-500 font-mono">
              Physiological Sigh &middot; 2s in &middot; 6s out
            </p>
          </button>

          
        </div>
      </main>

      {/* Subtle duration preview switch */}
      <footer className="pt-4 flex justify-center relative z-10">
        <button
          onClick={onToggleQuickTest}
          className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
        >
          {isQuickTestMode ? 'Duration: 30s preview' : 'Duration: Standard'}
        </button>
      </footer>
    </div>
  );
};
