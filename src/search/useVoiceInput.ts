import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {availableVoiceInputs, demoVoiceInput, type VoiceInput} from './voiceInput';

// Recognizers found on this page, and those that turned out not to work here
// (e.g. a browser's own SpeechRecognition without a microphone). Kept for the
// session, so the voice search entry disappears once nothing works.
let inputs: VoiceInput[] | null = null;
const failed = new Set<VoiceInput['kind']>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getVersion = () => version;

/** Test hook: forget what was detected (the page's APIs changed). */
export function resetVoiceInputs() {
  inputs = null;
  failed.clear();
  version += 1;
  listeners.forEach(listener => listener());
}

/**
 * The recognizer to use, or null when voice search is not available. In demo
 * mode a simulated one that "hears" `demoPhrase`.
 */
export function useVoiceInput(demoPhrase: string | null): {input: VoiceInput | null; notWorking(kind: VoiceInput['kind']): void} {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const notWorking = useCallback((kind: VoiceInput['kind']) => {
    failed.add(kind);
    version += 1;
    listeners.forEach(listener => listener());
  }, []);
  const demo = useMemo(() => (demoPhrase == null ? null : demoVoiceInput(demoPhrase)), [demoPhrase]);
  if (demo != null) {
    return {input: demo, notWorking};
  }
  inputs ??= typeof window === 'undefined' ? [] : availableVoiceInputs();
  return {input: inputs.find(input => !failed.has(input.kind)) ?? null, notWorking};
}
