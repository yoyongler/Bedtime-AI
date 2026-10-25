/**
 * Thin, typed wrapper around the Web Speech API's SpeechRecognition controller.
 *
 * TypeScript's DOM lib ships the event and result types (SpeechRecognitionEvent,
 * SpeechRecognitionResultList, SpeechRecognitionErrorCode) but not the controller
 * interface itself, nor the global constructor, so both are declared here.
 *
 * Controller support:
 *   Chrome / Edge  139+  desktop + Android   unprefixed `SpeechRecognition`
 *   Chrome / Edge  older                    `webkitSpeechRecognition`
 *   Safari         14.1+  macOS + iOS        `webkitSpeechRecognition`
 *   Firefox        none                     -> feature detection hides the UI
 *
 * Both this API and `getUserMedia` are secure-context only, so the whole feature
 * is unavailable over plain http on a LAN address.
 */

/** Result of `SpeechRecognition.available()`. */
export type SpeechAvailability = 'available' | 'downloading' | 'downloadable' | 'unavailable';

/** Recognition quality hint; only the on-device backends act on it today. */
export type SpeechRecognitionQuality = 'command' | 'dictation' | 'conversation';

export interface SpeechRecognitionOptions {
  langs?: string | string[];
  processLocally?: boolean;
  quality?: SpeechRecognitionQuality;
}

export interface SpeechRecognitionController extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Chrome 139+ only. Forces on-device recognition; needs the language pack. */
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionController;
  /** Chrome 142+ only. Experimental and gated by a Permissions-Policy. */
  available?: (options?: SpeechRecognitionOptions) => Promise<SpeechAvailability>;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/** The controller constructor, or null when this browser has no speech recognition. */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * The Web Speech API is only exposed in a secure context, so the mic button has to
 * stay hidden on a plain-http LAN address even in a browser that supports it.
 */
export function isSecureContextAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

export function isSpeechRecognitionSupported(): boolean {
  return isSecureContextAvailable() && getSpeechRecognitionConstructor() !== null;
}

/** The user's language, used to pick the recognition model. */
export function getPreferredLanguage(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  return navigator.language || 'en-US';
}

/**
 * Whether this browser can recognise the given language entirely on-device.
 *
 * This app handles people typing their private worries, so when the language pack
 * is already installed we keep the audio on the device instead of streaming it to a
 * cloud recogniser. Nothing is downloaded here: if the pack is missing we simply
 * fall back to whatever the browser does by default.
 */
export async function isOnDeviceRecognitionAvailable(lang: string): Promise<boolean> {
  const ctor = getSpeechRecognitionConstructor();
  if (!ctor || typeof ctor.available !== 'function') return false;

  try {
    const status = await ctor.available({
      langs: [lang],
      processLocally: true,
      quality: 'dictation',
    });
    return status === 'available';
  } catch {
    // The Permissions-Policy can block `available()`, and older builds simply do
    // not have it. Either way, fall back to the browser default.
    return false;
  }
}

/** Human readable explanation for a recognition error code. */
export function describeSpeechError(code: SpeechRecognitionErrorCode): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser settings, then try again.';
    case 'audio-capture':
      return 'No microphone was found on this device.';
    case 'network':
      return 'Could not reach the speech service. Check your connection, then try again — a VPN, firewall, or content blocker on this browser can also stop it.';
    case 'language-not-supported':
      return 'Speech recognition is not available for your language in this browser.';
    default:
      return 'Speech recognition failed. Please try again.';
  }
}
