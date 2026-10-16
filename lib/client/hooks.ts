"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

/**
 * A ref that always holds the latest `value`, for callbacks and timers that must not restart when it
 * changes. Updated after render (never during it), so render stays pure.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

const noop = () => () => {};

/** False during server rendering and hydration, true afterwards (e.g. before using document.body). */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
