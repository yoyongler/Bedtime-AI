import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const DEFAULT_FALLBACK =
  "Let go of today's burdens—you have done enough, and tomorrow will take care of itself.";

const MODEL = 'gemini-3.5-flash-lite';
const REQUEST_TIMEOUT_MS = 30000;
const HARD_TIMEOUT_MS = REQUEST_TIMEOUT_MS + 5000;
const MAX_OUTPUT_TOKENS = 512;
const TEST_MAX_OUTPUT_TOKENS = 256;

export type ReassuranceIssue =
  | { kind: 'missing-key' }
  | { kind: 'empty-response'; finishReason?: string; blockReason?: string }
  | { kind: 'api-error'; status?: number | string; message: string }
  | { kind: 'network-error'; message: string }
  | { kind: 'timeout' };

export interface ReassuranceResult {
  text: string;
  isAiGenerated: boolean;
  issue?: ReassuranceIssue;
}

export interface ApiKeyTestResult {
  ok: boolean;
  status?: number | string;
  message: string;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function extractApiMessage(message: string): string {
  const trimmed = message.trim();

  if (!trimmed.startsWith('{')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

export function describeApiError(status?: number | string, message?: string): string {
  const code = typeof status === 'number' ? status : Number(status);

  switch (code) {
    case 401:
    case 403:
      return message?.trim() || 'Gemini rejected this API key.';
    case 429:
      return 'Gemini quota or rate limit reached. Try again later.';
    case 503:
      return 'Gemini is busy right now. Try again shortly.';
    case 504:
      return 'Gemini took too long to respond. Try again.';
    default:
      return message?.trim() || 'Gemini returned an unknown error.';
  }
}

function getErrorDetails(error: unknown): {
  status?: number | string;
  message: string;
  isNetwork: boolean;
} {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as { status?: number | string; code?: number | string; message?: string })
      : undefined;

  const status = candidate?.status ?? candidate?.code;
  const message = sanitizeMessage(
    extractApiMessage(candidate?.message ?? String(error))
  );

  return {
    status,
    message: message || 'Unknown error',
    isNetwork: /failed to fetch|networkerror|load failed|err_network/i.test(message),
  };
}

/**
 * Safely resolves the Gemini API key from environment variables or custom input.
 */
export function getApiKey(overrideKey?: string): string | null {
  if (overrideKey && overrideKey.trim().length > 0) {
    return overrideKey.trim();
  }

  // Safe checks across Vite and Node-like environments
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
      return import.meta.env.VITE_GEMINI_API_KEY;
    }
  } catch {
    // Ignore error in environments where import.meta is restricted
  }

  try {
    if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }
  } catch {
    // Ignore error
  }

  // Fallback to localStorage if user configured it in the UI
  try {
    const saved = localStorage.getItem('bedtime_gemini_api_key');
    if (saved) return saved;
  } catch {
    // Ignore localStorage access restrictions
  }

  return null;
}

/**
 * Generates a calm, validating 1-sentence reassurance using gemini-3.5-flash-lite via @google/genai
 */
export async function generateBedtimeReassurance(
  thought: string,
  customApiKey?: string
): Promise<ReassuranceResult> {
  const apiKey = getApiKey(customApiKey);

  if (!apiKey) {
    console.warn('No Gemini API key provided. Using reassuring bedtime fallback.');
    return {
      text: DEFAULT_FALLBACK,
      isAiGenerated: false,
      issue: { kind: 'missing-key' },
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  console.info('Gemini request starting.', {
    model: MODEL,
    keyLength: apiKey.length,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Here is the lingering thought keeping me awake tonight: "${thought.trim()}"` }]
        }
      ],
      config: {
        systemInstruction:
          "You are a soft, reassuring bedtime assistant. Read the user's stress point and write exactly ONE sentence of calm, validating reassurance that helps them put the thought down for the night.",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: controller.signal,
        httpOptions: {
          timeout: REQUEST_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const outputText = response.text?.trim();
    if (outputText && outputText.length > 0) {
      // Clean up any extraneous quotes or multiple sentences if generated
      const cleaned = outputText.replace(/^["']|["']$/g, '').trim();
      return { text: cleaned, isAiGenerated: true };
    }

    const finishReason = candidate?.finishReason
      ? String(candidate.finishReason)
      : undefined;
    const blockReason = response.promptFeedback?.blockReason
      ? String(response.promptFeedback.blockReason)
      : undefined;

    console.warn('Gemini returned no usable text.', {
      finishReason,
      blockReason,
      usageMetadata: response.usageMetadata,
    });

    return {
      text: DEFAULT_FALLBACK,
      isAiGenerated: false,
      issue: { kind: 'empty-response', finishReason, blockReason },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      console.warn('Gemini request timed out.', { timeoutMs: HARD_TIMEOUT_MS });
      return {
        text: DEFAULT_FALLBACK,
        isAiGenerated: false,
        issue: { kind: 'timeout' },
      };
    }

    const { status, message, isNetwork } = getErrorDetails(error);

    console.error('Error generating bedtime reassurance with Gemini:', {
      status,
      message,
    });

    return {
      text: DEFAULT_FALLBACK,
      isAiGenerated: false,
      issue: isNetwork
        ? { kind: 'network-error', message }
        : { kind: 'api-error', status, message },
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function testGeminiApiKey(customApiKey?: string): Promise<ApiKeyTestResult> {
  const apiKey = getApiKey(customApiKey);

  if (!apiKey) {
    return { ok: false, message: 'No API key entered.' };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey });

    await ai.models.generateContent({
      model: MODEL,
      contents: 'Reply with the single word: OK.',
      config: {
        maxOutputTokens: TEST_MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: controller.signal,
        httpOptions: {
          timeout: REQUEST_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });

    return { ok: true, message: 'Key works and Gemini responded.' };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        message: `Request timed out after ${HARD_TIMEOUT_MS / 1000}s.`,
      };
    }

    const { status, message } = getErrorDetails(error);

    console.error('Gemini API key test failed:', { status, message });

    return { ok: false, status, message };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
