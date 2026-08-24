"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// document.body doesn't exist during SSR, and branching on `typeof document`
// directly in render makes the client's first hydration pass diverge from
// the server-rendered HTML. useSyncExternalStore reports `false` for both
// the server render and the client's hydration pass, then flips to `true`
// on the client-only re-render right after - no hydration mismatch either way.
function subscribeNever(): () => void {
  return () => {};
}
function getIsClientSnapshot(): boolean {
  return true;
}
function getIsClientServerSnapshot(): boolean {
  return false;
}

type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLES: Record<ToastKind, string> = {
  info: "bg-surface border-border text-ink",
  success: "bg-surface border-ok text-ink",
  error: "bg-surface border-danger text-danger",
};

const KIND_DOT: Record<ToastKind, string> = {
  info: "bg-accent",
  success: "bg-ok",
  error: "bg-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const isClient = useSyncExternalStore(
    subscribeNever,
    getIsClientSnapshot,
    getIsClientServerSnapshot
  );

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {isClient &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
            aria-live="polite"
            aria-atomic="true"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`animate-fade-in-up pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg ${KIND_STYLES[t.kind]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[t.kind]}`} />
                {t.message}
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
