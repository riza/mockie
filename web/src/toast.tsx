import { useEffect, useState } from 'react';

type Toast = { id: number; message: string; error: boolean };

let counter = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(message: string, error = false) {
  const t = { id: ++counter, message, error };
  listeners.forEach((fn) => fn(t));
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), true);
}

export function Toaster() {
  const [current, setCurrent] = useState<Toast | null>(null);

  useEffect(() => {
    const onToast = (t: Toast) => setCurrent(t);
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setCurrent(null), current.error ? 5000 : 2500);
    return () => window.clearTimeout(id);
  }, [current]);

  if (!current) return null;
  return <div className={`toast${current.error ? ' err' : ''}`}>{current.message}</div>;
}
