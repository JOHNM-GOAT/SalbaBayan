/**
 * Persisted single-value preferences (selected language, selected Purok).
 *
 * These are browser-owned state, not React state, so they are exposed as an
 * external store rather than copied into `useState` inside an effect. Copying
 * meant the first paint always showed the default and corrected on a second
 * render — visible as a flash of the wrong language on every load.
 *
 * Subscribing to `storage` also makes a change propagate across tabs, which
 * matters more than it sounds: an official with the advisory open on one tab
 * and the coverage matrix on another should not see two different languages.
 */

export type PrefStore = {
  subscribe: (onChange: () => void) => () => void;
  get: () => string | null;
  set: (value: string) => void;
};

export function createPrefStore(key: string): PrefStore {
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((fn) => fn());
  }

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      // `storage` fires only in OTHER tabs, so same-tab updates go through
      // `notify` instead. Both paths are needed.
      window.addEventListener("storage", onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },

    /*
     * Returns a primitive, so React's identity check on the snapshot is a
     * value comparison and cannot loop. Reading straight from localStorage on
     * every call is safe for the same reason — no allocation, no new object.
     */
    get() {
      try {
        return localStorage.getItem(key);
      } catch {
        // Private mode or storage disabled. Treated as "no choice recorded".
        return null;
      }
    },

    set(value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Not remembered across sessions. The in-memory notify below still
        // applies the choice for this one, which is what the user just asked
        // for — failing the tap would be worse than forgetting it later.
      }
      notify();
    },
  };
}

/** Server render has no localStorage; null means "fall back to the default". */
export const noStoredValue = () => null;

export const languagePref = createPrefStore("salbabayan.language");
export const purokPref = createPrefStore("salbabayan.purok");

/*
 * The chosen actor. Stored the same way and for the same reason: it decides
 * what the very first paint renders, so reading it in an effect would flash
 * the resident tab bar before correcting to the official one.
 *
 * Storing it does NOT store a permission — see lib/actors.ts. It is a view
 * preference, and RLS is unaffected by it.
 */
export const actorPref = createPrefStore("salbabayan.actor");
