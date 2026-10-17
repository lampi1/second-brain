// Session-only draft cache survives page navigation and language remounts; never persists personal text to product files.
import { useState, type Dispatch, type SetStateAction } from 'react';
const drafts = new Map<string, unknown>();
export function useSectionDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => drafts.has(key) ? drafts.get(key) as T : initial);
  const set: Dispatch<SetStateAction<T>> = next => setValue(previous => {
    const updated = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
    drafts.set(key, updated); return updated;
  });
  return [value, set];
}
