/**
 * A minimal localStorage-backed store compatible with useSyncExternalStore.
 * Centralizing this avoids reading storage inside effects + setState, which
 * both risks SSR/CSR hydration mismatches and trips the
 * react-hooks/set-state-in-effect rule - useSyncExternalStore is the
 * pattern React recommends for synchronizing with external mutable state.
 */
export interface LocalStorageStore<T> {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (value: T) => { ok: boolean; error?: string };
}

export function createLocalStorageStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
  serverValue: T
): LocalStorageStore<T> {
  let cachedRaw: string | null | undefined;
  let cachedValue: T = serverValue;
  const listeners = new Set<() => void>();

  function readRaw(): string | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function getSnapshot(): T {
    const raw = readRaw();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = parse(raw);
    }
    return cachedValue;
  }

  function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    function handleStorage(e: StorageEvent) {
      if (e.key === key || e.key === null) onChange();
    }
    window.addEventListener("storage", handleStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  function set(value: T): { ok: boolean; error?: string } {
    try {
      const raw = serialize(value);
      window.localStorage.setItem(key, raw);
      cachedRaw = raw;
      cachedValue = value;
      listeners.forEach((l) => l());
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "QuotaExceededError"
          ? "Storage is full. Delete an old writing style to free up space."
          : "Couldn't save to local storage on this device.";
      return { ok: false, error: message };
    }
  }

  return { subscribe, getSnapshot, getServerSnapshot: () => serverValue, set };
}
