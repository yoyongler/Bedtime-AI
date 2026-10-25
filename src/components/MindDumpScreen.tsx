import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Mic, Square } from 'lucide-react';
import { describeApiError, generateBedtimeReassurance, type ReassuranceIssue } from '../services/gemini';
import { useSpeechToText } from '../hooks/useSpeechToText';

interface MindDumpScreenProps {
  onBack: () => void;
  onProceedToExercise: (reassurance: string) => void;
  customApiKey?: string;
}

type Stage = 'input' | 'fading-input' | 'quote-active' | 'quote-fading';

const QUOTE_BASE_DURATION_MS = 5000;
const QUOTE_MS_PER_CHAR = 30;
const QUOTE_MAX_DURATION_MS = 14000;
const QUOTE_FADE_MS = 800;

const getQuoteDuration = (text: string): number => {
  const length = text.trim().length;
  return Math.min(
    QUOTE_MAX_DURATION_MS,
    Math.max(QUOTE_BASE_DURATION_MS, QUOTE_BASE_DURATION_MS + length * QUOTE_MS_PER_CHAR)
  );
};

const formatIssue = (issue: ReassuranceIssue): string => {
  switch (issue.kind) {
    case 'missing-key':
      return 'no API key saved on this site';
    case 'empty-response': {
      const details = [
        issue.finishReason ? `finish: ${issue.finishReason}` : '',
        issue.blockReason ? `blocked: ${issue.blockReason}` : '',
      ].filter(Boolean);
      return details.length > 0 ? `empty response (${details.join(', ')})` : 'empty response';
    }
    case 'api-error':
      return issue.status
        ? `${issue.status}: ${describeApiError(issue.status, issue.message)}`
        : describeApiError(undefined, issue.message);
    case 'network-error':
      return `network: ${issue.message}`;
    case 'timeout':
      return 'request timed out';
    default:
      return 'unknown error';
  }
};

export const MindDumpScreen: React.FC<MindDumpScreenProps> = ({
  onBack,
  onProceedToExercise,
  customApiKey,
}) => {
  const [thought, setThought] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reassurance, setReassurance] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState<boolean>(true);
  const [aiIssue, setAiIssue] = useState<ReassuranceIssue | null>(null);
  const [stage, setStage] = useState<Stage>('input');
  const [isProgressBarActive, setIsProgressBarActive] = useState<boolean>(false);
  const isDebugMode = new URLSearchParams(window.location.search).get('debug') === '1';

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timeoutRefs = useRef<number[]>([]);
  const thoughtRef = useRef(thought);

  useEffect(() => {
    thoughtRef.current = thought;
  }, [thought]);

  const addTimeout = (fn: () => void, delayMs: number) => {
    const id = window.setTimeout(fn, delayMs);
    timeoutRefs.current.push(id);
    return id;
  };

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((id) => window.clearTimeout(id));
      timeoutRefs.current = [];
    };
  }, []);

  const handleFinalSpeech = useCallback((text: string) => {
    const spoken = text.trim();
    if (!spoken) return;
    setThought((previous) => (previous.trim() ? `${previous.trim()} ${spoken}` : spoken));
  }, []);

  const {
    isSupported: isDictationSupported,
    isListening,
    interimText,
    errorMessage: dictationError,
    stop: stopDictation,
    toggle: toggleDictation,
  } = useSpeechToText({ onFinalText: handleFinalSpeech });

  const handleToggleDictation = () => {
    if (!isListening && textareaRef.current) {
      // Dismiss the on-screen keyboard so it does not crowd the field while speaking.
      textareaRef.current.blur();
    }
    toggleDictation();
  };

  const handleRelease = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting || stage !== 'input') return;

    if (isListening) {
      stopDictation();
      // The recogniser hands over its last phrase asynchronously when it stops, so
      // wait for it to land before the thought is sent to Gemini.
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    // Immediately dismiss mobile virtual keyboard
    if (textareaRef.current) {
      textareaRef.current.blur();
    }

    setIsSubmitting(true);
    setAiIssue(null);

    const inputThought =
      (thoughtRef.current || thought).trim() || 'Lingering thoughts and concerns.';
    const result = await generateBedtimeReassurance(inputThought, customApiKey);
    const quoteDurationMs = getQuoteDuration(result.text);

    // 1. Gently fade out the input form
    setStage('fading-input');

    // 2. After 600ms fade-out, reveal the AI reassurance quote
    addTimeout(() => {
      setReassurance(result.text);
      setIsAiGenerated(result.isAiGenerated);
      setAiIssue(result.issue ?? null);
      setStage('quote-active');
      setIsSubmitting(false);

      // Start the countdown progress bar
      addTimeout(() => {
        setIsProgressBarActive(true);
      }, 50);

      // 3. Near the end of the reading time, gently fade out the quote
      addTimeout(() => {
        setStage('quote-fading');
      }, Math.max(0, quoteDurationMs - QUOTE_FADE_MS));

      // 4. Once the reading time ends, smoothly proceed to the breathing exercise
      addTimeout(() => {
        onProceedToExercise(result.text);
      }, quoteDurationMs);
    }, 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRelease();
    }
  };

  const showInput = stage === 'input' || stage === 'fading-input';
  const showQuote = stage === 'quote-active' || stage === 'quote-fading';
  const progressDurationMs = Math.max(0, (reassurance ? getQuoteDuration(reassurance) : 0) - 50);

  return (
    <div className="relative min-h-screen bg-[#050505] text-zinc-200 flex flex-col justify-between px-6 py-10 max-w-lg mx-auto overflow-hidden">
      {/* Soft background ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      {/* Top back navigation */}
      <header className="flex items-center relative z-10">
        {showInput ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        ) : (
          <div className="h-4" />
        )}
      </header>

      {/* Main Area */}
      <main className="my-auto py-6 relative z-10">
        {showInput && (
          <form
            onSubmit={handleRelease}
            className={`space-y-6 transition-all duration-700 ease-in-out ${
              stage === 'fading-input'
                ? 'opacity-0 scale-[0.98] pointer-events-none'
                : 'opacity-100 scale-100'
            }`}
          >
            <h1 className="text-2xl font-serif-calm text-zinc-100 text-center">
              What is one lingering thought on your mind tonight?
            </h1>

            <div className="space-y-2">
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  rows={4}
                  value={thought}
                  onChange={(e) => setThought(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g., An unfinished email, tomorrow's schedule, worrying if I did enough..."
                  disabled={isSubmitting}
                  className="w-full p-4 pb-11 pr-14 text-sm bg-zinc-900/70 border border-zinc-800/90 focus:border-teal-500/40 hover:shadow-[0_0_30px_rgba(20,184,166,0.06)] rounded-xl text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-all resize-none disabled:opacity-50"
                  autoFocus
                />

                {isDictationSupported && (
                  <button
                    type="button"
                    onClick={handleToggleDictation}
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={isSubmitting}
                    aria-label={isListening ? 'Stop dictation' : 'Dictate your thought'}
                    aria-pressed={isListening}
                    title={
                      isListening
                        ? 'Stop dictation'
                        : 'Tap and speak your mind'
                    }
                    className={`absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      isListening
                        ? 'mic-listening border-red-500/40 bg-red-500/15 text-red-300'
                        : 'border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    {isListening ? (
                      <Square className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>

              <div aria-live="polite" className="min-h-[16px] px-1">
                {dictationError ? (
                  <p className="text-[11px] text-amber-400/90">{dictationError}</p>
                ) : isListening ? (
                  <p className="truncate text-[11px] italic text-zinc-500">
                    {interimText ? `“${interimText}”` : 'Listening…'}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-lg bg-zinc-200 text-zinc-950 font-medium text-sm hover:bg-zinc-100 active:opacity-90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'Releasing...' : 'Release'}
              </button>
              <span className="text-[11px] text-zinc-600">
                Press Enter to release &middot; Shift + Enter for new line
              </span>
            </div>
          </form>
        )}

        {showQuote && reassurance && (
          <div
            className={`text-center space-y-6 transition-all duration-800 ease-in-out ${
              stage === 'quote-active'
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-[0.98]'
            }`}
          >
            {/* Reassurance quote card */}
            <div className="p-8 rounded-2xl bg-zinc-900/60 border border-indigo-500/20 shadow-[0_0_50px_rgba(99,102,241,0.08)] relative overflow-hidden">
              <blockquote className="text-xl sm:text-2xl font-serif-calm text-zinc-100 leading-relaxed italic whitespace-pre-line">
                &ldquo;{reassurance}&rdquo;
              </blockquote>
            </div>

            {/* Subtle countdown progress bar */}
            <div className="w-48 h-0.5 bg-zinc-900/80 rounded-full mx-auto overflow-hidden">
              <div
                className="h-full bg-indigo-400/50 rounded-full transition-all ease-linear"
                style={{
                  width: isProgressBarActive ? '0%' : '100%',
                  transitionDuration: isProgressBarActive ? `${progressDurationMs}ms` : '0ms',
                }}
              />
            </div>

            {!isAiGenerated && (
              <p className="text-[11px] text-zinc-600">
                Offline reassurance &middot;{' '}
                {aiIssue?.kind === 'missing-key'
                  ? 'add a Gemini key for a personal reply'
                  : 'AI unavailable right now'}
                {isDebugMode && aiIssue && aiIssue.kind !== 'missing-key'
                  ? ` (${formatIssue(aiIssue)})`
                  : ''}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Empty footer for consistent vertical alignment */}
      <footer className="h-4 relative z-10" />
    </div>
  );
};
