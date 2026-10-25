import React, { useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { describeApiError, testGeminiApiKey, type ApiKeyTestResult } from '../services/gemini';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  currentKey: string;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSave,
  currentKey,
}) => {
  const [val, setVal] = useState(currentKey);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testResult, setTestResult] = useState<ApiKeyTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const testRequestId = useRef(0);

  if (!isOpen) return null;

  const handleClose = () => {
    testRequestId.current += 1;
    setVal(currentKey);
    setTestResult(null);
    setIsTesting(false);
    onClose();
  };

  const handleSave = () => {
    testRequestId.current += 1;
    const trimmed = val.trim();
    setVal(trimmed);
    onSave(trimmed);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setTestResult(null);
      setIsTesting(false);
      onClose();
    }, 700);
  };

  const handleClear = () => {
    testRequestId.current += 1;
    setVal('');
    setTestResult(null);
    setIsTesting(false);
    onSave('');
  };

  const handleTest = async () => {
    const key = val.trim();

    if (!key) {
      setTestResult({ ok: false, message: 'Enter a key first.' });
      return;
    }

    const requestId = ++testRequestId.current;
    setVal(key);
    onSave(key);
    setIsTesting(true);
    setTestResult(null);

    const result = await testGeminiApiKey(key);

    if (testRequestId.current !== requestId) {
      return;
    }

    setTestResult(result);
    setIsTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-sm p-5 bg-zinc-950 border border-zinc-800 rounded-xl text-left">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-zinc-200">Gemini API Key</h3>
          <button
            onClick={handleClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          type="password"
          value={val}
          autoFocus
          onChange={(e) => {
            setVal(e.target.value);
            setTestResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="API Key"
          className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 font-mono mb-3"
        />

        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          Testing also saves the key in this browser for this exact address. Re-enter it if the port or domain changes.
        </p>

        {isTesting && (
          <p className="mb-3 text-xs text-zinc-500" role="status">
            Contacting Gemini…
          </p>
        )}

        {testResult && (
          <p
            className={`mb-3 text-xs leading-relaxed ${testResult.ok ? 'text-emerald-400' : 'text-amber-400'}`}
            role="status"
          >
            {testResult.ok
              ? testResult.message
              : testResult.status
                ? `Key test failed (${testResult.status}): ${describeApiError(testResult.status, testResult.message)}`
                : describeApiError(undefined, testResult.message)}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-zinc-500 hover:text-zinc-400"
          >
            Clear
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              {isTesting ? 'Testing…' : 'Test & save'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg flex items-center gap-1.5"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Saved
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
