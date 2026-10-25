import React from 'react';

interface CompletionScreenProps {
  onRestart: () => void;
}

export const CompletionScreen: React.FC<CompletionScreenProps> = ({ onRestart }) => {
  return (
    <div className="relative min-h-screen bg-[#050505] text-zinc-200 flex flex-col items-center justify-between py-16 px-6 text-center select-none animate-soft-fade overflow-hidden">
      {/* Soft background ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <div className="h-6 relative z-10" />

      {/* Minimalist Message */}
      <main className="my-auto relative z-10">
        <h1 className="text-3xl sm:text-4xl font-serif-calm text-zinc-100 tracking-wide font-normal">
          You're all set.
        </h1>
      </main>

      {/* Subtle, low-opacity return button */}
      <footer className="relative z-10">
        <button
          onClick={onRestart}
          className="text-xs text-zinc-500 hover:text-zinc-300 opacity-40 hover:opacity-100 transition-opacity cursor-pointer py-2 px-4 rounded-lg"
        >
          Return to start
        </button>
      </footer>
    </div>
  );
};
