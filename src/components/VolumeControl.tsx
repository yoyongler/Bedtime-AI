import React, { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
}

/**
 * Dropdown sound control. A single master slider for the whole session output
 * (bell, breath noise, ambient bed and drone), plus a quick mute toggle.
 */
export const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const isSilent = isMuted || volume <= 0;
  const LevelIcon = isSilent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Sound settings"
        aria-expanded={isOpen}
        title="Sound settings"
        className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors cursor-pointer"
      >
        <LevelIcon className={`w-4 h-4 ${isSilent ? '' : 'text-zinc-300'}`} />
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 z-30 w-56 rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-md animate-drop-in"
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              className={`flex items-center gap-2 text-xs transition-colors cursor-pointer ${
                isMuted ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-300 hover:text-zinc-100'
              }`}
            >
              <LevelIcon className="w-3.5 h-3.5" />
              <span>{isMuted ? 'Muted' : 'Sound'}</span>
            </button>
            <span className="text-[11px] font-mono text-zinc-500">
              {Math.round(volume * 100)}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Volume"
            className="volume-slider"
          />

          <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-zinc-600">
            <span>quiet</span>
            <span>loud</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VolumeControl;
