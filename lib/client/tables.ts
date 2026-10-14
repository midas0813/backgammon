"use client";

/**
 * Tables this browser is hosting and waiting on. Kept in sessionStorage so the app-wide watcher keeps
 * listening after a reload; the server only reports tables the caller actually hosts.
 */
const KEY = "bg:watched-tables";
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(ids: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {}
  listeners.forEach((l) => l());
}

export const watchedTables = () => read();
export function watchTable(id: string) {
  const ids = read();
  if (!ids.includes(id)) write([...ids, id].slice(-5));
}
export function unwatchTable(id: string) {
  write(read().filter((x) => x !== id));
}
export function onTablesChange(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
