"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = {
  id: number;
  message: string;
  link?: { label: string; href: string };
  durationMs: number;
};

type Ctx = {
  show: (message: string, opts?: { link?: Toast["link"]; durationMs?: number }) => void;
};

const ToastContext = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback<Ctx["show"]>((message, opts) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const t: Toast = { id, message, link: opts?.link, durationMs: opts?.durationMs ?? 4000 };
    setToasts((prev) => [...prev, t]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.durationMs);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-elevated"
          >
            <span>{t.message}</span>
            {t.link ? (
              <a href={t.link.href} className="underline underline-offset-2 hover:text-accent">
                {t.link.label}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
