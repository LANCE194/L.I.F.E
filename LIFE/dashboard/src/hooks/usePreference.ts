import { useCallback, useState } from 'react';

/** A boolean preference remembered in this browser (falls back to memory if storage is blocked). */
export function usePreference(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });

  const update = useCallback((next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // storage unavailable (private mode); keep the in-memory value
    }
  }, [key]);

  return [value, update];
}

/** A choice from a fixed list, remembered in this browser. */
export function useChoicePreference<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored !== null && allowed.includes(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback((next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // storage unavailable; keep the in-memory value
    }
  }, [key]);

  return [value, update];
}
