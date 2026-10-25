import { useState, useEffect } from 'react';
import type { Screen, ExerciseType } from './types';
import { EXERCISES } from './constants/exercises';
import { soundSynth } from './utils/audio';
import { HomeScreen } from './components/HomeScreen';
import { MindDumpScreen } from './components/MindDumpScreen';
import { ExerciseScreen } from './components/ExerciseScreen';
import { CompletionScreen } from './components/CompletionScreen';
import { ApiKeyModal } from './components/ApiKeyModal';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [exerciseType, setExerciseType] = useState<ExerciseType>('4-7-8');
  const [isQuickTestMode, setIsQuickTestMode] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    // Default to ON (isMuted = false)
    return soundSynth.getIsMuted();
  });
  const [volume, setVolume] = useState<number>(() => soundSynth.getVolume());
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [isScreenFading, setIsScreenFading] = useState<boolean>(false);
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('bedtime_gemini_api_key') || '';
    } catch {
      return '';
    }
  });

  // Keep the ambient bed and low drone running only while an exercise is in progress
  useEffect(() => {
    if (!isMuted && screen === 'exercise') {
      soundSynth.startAmbiance();
      soundSynth.startDrone();
    } else {
      soundSynth.stopAmbiance();
      soundSynth.stopDrone();
    }
  }, [isMuted, screen]);

  // Smooth, calming screen transition orchestrator
  const navigateWithFade = (targetScreen: Screen, onBeforeMount?: () => void) => {
    setIsScreenFading(true);
    setTimeout(() => {
      if (onBeforeMount) onBeforeMount();
      setScreen(targetScreen);
      requestAnimationFrame(() => {
        setIsScreenFading(false);
      });
    }, 450);
  };

  const handleSelectOption = (type: ExerciseType) => {
    // Must happen inside the click gesture, otherwise mobile browsers refuse to
    // start the AudioContext and the session begins in silence.
    soundSynth.unlock();
    if (type === 'mind-dump') {
      navigateWithFade('mind-dump', () => setExerciseType(type));
    } else {
      navigateWithFade('exercise', () => setExerciseType(type));
    }
  };

  const handleProceedFromMindDump = () => {
    setScreen('exercise');
  };

  const handleExerciseComplete = () => {
    // Directly show completion screen as ExerciseScreen has already faded out its ring
    setScreen('complete');
  };

  const handleReturnToStart = () => {
    navigateWithFade('home');
  };

  const handleToggleSound = () => {
    const unmuted = soundSynth.toggleMute();
    setIsMuted(!unmuted);
  };

  const handleVolumeChange = (nextVolume: number) => {
    soundSynth.setVolume(nextVolume);
    setVolume(nextVolume);
  };

  const handleSaveApiKey = (key: string) => {
    setCustomApiKey(key);
    try {
      if (key) {
        localStorage.setItem('bedtime_gemini_api_key', key);
      } else {
        localStorage.removeItem('bedtime_gemini_api_key');
      }
    } catch {
      // Safe fallback
    }
  };

  const activeExerciseConfig = EXERCISES[exerciseType] || EXERCISES['4-7-8'];
  const effectiveDuration = isQuickTestMode ? 30 : activeExerciseConfig.defaultDurationSeconds;

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-200">
      <div
        className={`transition-opacity duration-700 ease-in-out ${
          isScreenFading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {screen === 'home' && (
          <HomeScreen
            onSelectOption={handleSelectOption}
            isQuickTestMode={isQuickTestMode}
            onToggleQuickTest={() => setIsQuickTestMode(!isQuickTestMode)}
            volume={volume}
            isMuted={isMuted}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleSound}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            hasCustomKey={Boolean(customApiKey)}
          />
        )}

        {screen === 'mind-dump' && (
          <MindDumpScreen
            onBack={handleReturnToStart}
            onProceedToExercise={handleProceedFromMindDump}
            customApiKey={customApiKey}
          />
        )}

        {screen === 'exercise' && (
          <ExerciseScreen
            exercise={activeExerciseConfig}
            totalDurationSeconds={effectiveDuration}
            onComplete={handleExerciseComplete}
            onExitEarly={handleReturnToStart}
          />
        )}

        {screen === 'complete' && (
          <CompletionScreen onRestart={handleReturnToStart} />
        )}
      </div>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
        currentKey={customApiKey}
      />
    </div>
  );
}

export default App;
