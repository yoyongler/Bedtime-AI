import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeSpeechError,
  getPreferredLanguage,
  getSpeechRecognitionConstructor,
  isOnDeviceRecognitionAvailable,
  isSpeechRecognitionSupported,
} from '../utils/speechRecognition';
import type { SpeechRecognitionController } from '../utils/speechRecognition';

/** Hard cap on a single dictation session, so a forgotten mic cannot run all night. */
const MAX_SESSION_MS = 120_000;

/** Delay before restarting after Chrome closes a recognition session on its own. */
const RESTART_DELAY_MS = 250;

/**
 * How many times a `network` error is retried before the failure is shown.
 *
 * The browser's cloud recogniser regularly fails its very first connection — a
 * cold service, a just-woken laptop, a flaky DNS lookup — and succeeds on the next
 * attempt. Treating the first failure as fatal turned a spinner into a scary error
 * message, so each session gets a couple of silent retries before we give up.
 */
const MAX_NETWORK_RETRIES = 2;

export interface UseSpeechToTextOptions {
  /** Called with each completed phrase, in the order it was recognised. */
  onFinalText: (text: string) => void;
}

export interface UseSpeechToTextResult {
  /** False when the browser has no speech recognition, or the page is not secure. */
  isSupported: boolean;
  isListening: boolean;
  /** Words heard so far in the current phrase, not yet committed. */
  interimText: string;
  errorMessage: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Wraps the Web Speech API in a React-friendly shape.
 *
 * The browser's continuous mode is unreliable for dictation: Chrome closes a
 * session after a pause in speech, and iOS Safari stops after a single phrase.
 * So every session end is treated as a soft pause and the recogniser is started
 * again, with the confirmed words carried over.
 */
export const useSpeechToText = ({
  onFinalText,
}: UseSpeechToTextOptions): UseSpeechToTextResult => {
  const [isSupported] = useState(() => isSpeechRecognitionSupported());
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canUseOnDevice, setCanUseOnDevice] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionController | null>(null);
  const wantsToListenRef = useRef(false);
  /** How many results of the current session have already been committed. */
  const consumedRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  /** Consecutive `network` failures in the current session, used to decide when to give up. */
  const networkRetryRef = useRef(0);
  const onFinalTextRef = useRef(onFinalText);
  const canUseOnDeviceRef = useRef(false);
  const langRef = useRef(getPreferredLanguage());
  const isMountedRef = useRef(true);

  useEffect(() => {
    onFinalTextRef.current = onFinalText;
    canUseOnDeviceRef.current = canUseOnDevice;
  }, [onFinalText, canUseOnDevice]);

  // Checked once up front: whether the on-device language pack is installed does not
  // change while the page is open, and the answer has to be known before the
  // recogniser starts, because `start()` must run inside the click's user gesture.
  useEffect(() => {
    if (!isSupported) return;

    let cancelled = false;
    void isOnDeviceRecognitionAvailable(langRef.current).then((available) => {
      if (!cancelled) setCanUseOnDevice(available);
    });

    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const handleResult = useCallback((event: SpeechRecognitionEvent) => {
    const results = event.results;
    const lastIndex = results.length - 1;
    let interim = '';

    for (let i = consumedRef.current; i <= lastIndex; i++) {
      const result = results[i];
      const transcript = result[0]?.transcript ?? '';

      if (i < lastIndex || result.isFinal) {
        consumedRef.current = i + 1;
        // Hearing speech means the service is healthy again, so later transient
        // failures deserve a fresh set of retries.
        networkRetryRef.current = 0;
        if (transcript.trim()) onFinalTextRef.current(transcript);
      } else {
        // Only the trailing result can still change, so it is the interim one.
        interim = transcript;
      }
    }

    if (isMountedRef.current) setInterimText(interim);
  }, []);

  const handleError = useCallback((event: SpeechRecognitionErrorEvent) => {
    const code = event.error;

    // Silence and a deliberate stop are both routine; the session end that follows
    // decides whether to pick listening back up.
    if (code === 'no-speech' || code === 'aborted') return;

    // The on-device pack can disappear between the availability check and the
    // start. Drop back to the browser default and let the restart try again.
    if (code === 'language-not-supported' && recognitionRef.current?.processLocally) {
      recognitionRef.current.processLocally = false;
      return;
    }

    // A network failure is usually a cold or flaky service, not a dead one. Leave
    // the session open so `onend` restarts it, and only surface the error once the
    // retries are used up.
    if (code === 'network' && networkRetryRef.current < MAX_NETWORK_RETRIES) {
      networkRetryRef.current += 1;
      return;
    }

    wantsToListenRef.current = false;
    if (!isMountedRef.current) return;
    setErrorMessage(describeSpeechError(code));
    setIsListening(false);
    setInterimText('');
  }, []);

  const handleEnd = useCallback(() => {
    if (!wantsToListenRef.current) {
      if (isMountedRef.current) {
        setIsListening(false);
        setInterimText('');
      }
      return;
    }

    // The browser closed the session on its own. A fresh session starts its result
    // list from zero again.
    consumedRef.current = 0;

    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!wantsToListenRef.current) return;
      const recognition = recognitionRef.current;
      if (!recognition) return;
      try {
        recognition.start();
      } catch {
        // Already running; nothing to do.
      }
    }, RESTART_DELAY_MS);
  }, []);

  const ensureRecognition = useCallback((): SpeechRecognitionController | null => {
    const ctor = getSpeechRecognitionConstructor();
    if (!ctor) return null;

    const existing = recognitionRef.current;
    if (existing) return existing;

    const recognition = new ctor();
    recognition.lang = langRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = handleResult;
    recognition.onerror = handleError;
    recognition.onend = handleEnd;
    recognition.onstart = () => {
      if (isMountedRef.current) setIsListening(true);
    };
    recognitionRef.current = recognition;
    return recognition;
  }, [handleResult, handleError, handleEnd]);

  const stop = useCallback(() => {
    wantsToListenRef.current = false;
    clearTimers();

    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Was not running.
      }
    }

    if (!isMountedRef.current) return;
    setIsListening(false);
    setInterimText('');
  }, [clearTimers]);

  const start = useCallback(() => {
    if (!isSupported) return;

    const recognition = ensureRecognition();
    if (!recognition) return;

    clearTimers();
    setErrorMessage(null);
    setInterimText('');
    wantsToListenRef.current = true;
    consumedRef.current = 0;
    networkRetryRef.current = 0;
    recognition.processLocally = canUseOnDeviceRef.current;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // Already running.
      return;
    }

    sessionTimerRef.current = window.setTimeout(() => {
      stop();
    }, MAX_SESSION_MS);
  }, [clearTimers, ensureRecognition, isSupported, stop]);

  const toggle = useCallback(() => {
    if (wantsToListenRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      wantsToListenRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      if (sessionTimerRef.current !== null) window.clearTimeout(sessionTimerRef.current);
      restartTimerRef.current = null;
      sessionTimerRef.current = null;

      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // Was not running.
        }
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    interimText,
    errorMessage,
    start,
    stop,
    toggle,
  };
};

export default useSpeechToText;
