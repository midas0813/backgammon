"use client";

/** Opens the app's "Connect a wallet" dialog from anywhere (header button, sign-up page, admin). */
type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();
let isOpen = false;

export function openWalletDialog() {
  isOpen = true;
  listeners.forEach((l) => l(true));
}
export function closeWalletDialog() {
  isOpen = false;
  listeners.forEach((l) => l(false));
}
export const walletDialogStore = {
  subscribe(cb: () => void) {
    const l: Listener = () => cb();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => isOpen,
  server: () => false,
};
