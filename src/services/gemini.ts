import { GoogleGenAI } from '@google/genai';

const DEFAULT_FALLBACK =
  "Let go of today's burdens—you have done enough, and tomorrow will take care of itself.";

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
 * Generates a calm, validating 1-sentence reassurance using gemini-2.0-flash via @google/genai
 */
export async function generateBedtimeReassurance(
  thought: string,
  customApiKey?: string
): Promise<{ text: string; isAiGenerated: boolean }> {
  const apiKey = getApiKey(customApiKey);

  if (!apiKey) {
    console.warn('No Gemini API key provided. Using reassuring bedtime fallback.');
    return { text: DEFAULT_FALLBACK, isAiGenerated: false };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: `Here is the lingering thought keeping me awake tonight: "${thought.trim()}"` }]
        }
      ],
      config: {
        systemInstruction:
          "You are a soft, reassuring bedtime assistant. Read the user's stress point and write exactly ONE sentence of calm, validating reassurance that helps them put the thought down for the night.",
        temperature: 0.7,
        maxOutputTokens: 100,
      },
    });

    const outputText = response.text?.trim();
    if (outputText && outputText.length > 0) {
      // Clean up any extraneous quotes or multiple sentences if generated
      const cleaned = outputText.replace(/^["']|["']$/g, '').trim();
      return { text: cleaned, isAiGenerated: true };
    }

    return { text: DEFAULT_FALLBACK, isAiGenerated: false };
  } catch (error) {
    console.error('Error generating bedtime reassurance with Gemini:', error);
    return { text: DEFAULT_FALLBACK, isAiGenerated: false };
  }
}
