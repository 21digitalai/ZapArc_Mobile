/**
 * createStore — a tiny module-level shared store backed by useSyncExternalStore.
 *
 * Hooks that load shared data (settings, contacts, currency rates, …) should
 * use ONE store instance so every consumer sees the same state and a mutation
 * from any screen updates them all at once. Per-instance `useState` copies are
 * the classic source of "I changed it over here but the other screen still
 * shows the old value" bugs.
 *
 * Usage:
 *   const store = createStore({ value: 0 });
 *   // in a hook:  const { value } = store.useStore();
 *   // anywhere:   store.setState({ value: 1 });   // notifies all consumers
 */
import { useSyncExternalStore } from 'react';

export interface Store<T extends object> {
  /** Current snapshot (stable reference until the next setState). */
  getState: () => T;
  /** Merge a partial (or updater) into the state and notify subscribers. */
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void;
  /** Low-level subscription (rarely needed directly). */
  subscribe: (listener: () => void) => () => void;
  /** React hook returning the full state; re-renders on any change. */
  useStore: () => T;
}

export function createStore<T extends object>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<() => void>();

  const getState = (): T => state;

  const setState = (partial: Partial<T> | ((prev: T) => Partial<T>)): void => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const useStore = (): T => useSyncExternalStore(subscribe, getState);

  return { getState, setState, subscribe, useStore };
}
