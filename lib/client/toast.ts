"use client";

/** App-wide toasts (e.g. "Opponent found" while on another page). */
export interface Toast {
  id: number;
  text: string;
  tone?: "info" | "ok" | "warn";
  action?: { label: string; href: string };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: Omit<Toast, "id" | "text"> & { ms?: number } = {}) {
  const t: Toast = { id: nextId++, text, tone: opts.tone, action: opts.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  window.setTimeout(() => dismiss(t.id), opts.ms ?? 4500);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toastStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => toasts,
  server: (): Toast[] => [],
};
