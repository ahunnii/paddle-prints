"use client";

/**
 * A homegrown toast system: a module-global zustand store plus the `<Toaster />` stack that
 * renders it. The store lives outside React so `toast(...)` is callable from anywhere -- including
 * right before a `router.push()`, since a page navigation doesn't touch this module-level state.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";

interface Toast {
  id: number;
  message: string;
  variant: "success" | "info" | "error";
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Toast) => void;
  dismiss: (id: number) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let nextId = 0;
const AUTO_DISMISS_MS = 3500;

/** Fire a toast from anywhere -- React components, event handlers, or plain modules. */
export function toast(message: string, variant: Toast["variant"] = "success") {
  const id = nextId++;
  useToastStore.getState().push({ id, message, variant });
  setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS);
}

const VARIANT_DOT: Record<Toast["variant"], string> = {
  success: "bg-emerald-400",
  error: "bg-red-400",
  info: "bg-sky-400",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastPill key={t.id} toast={t} onDone={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastPill({ toast: t, onDone }: { toast: Toast; onDone: () => void }) {
  // Mount in the "hidden" position, then flip to "entered" on the next tick so the transition
  // classes actually animate instead of snapping straight to the resting state.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      onClick={onDone}
      className={`pointer-events-auto flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg transition-all duration-300 ${
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${VARIANT_DOT[t.variant]}`} />
      {t.message}
    </div>
  );
}
