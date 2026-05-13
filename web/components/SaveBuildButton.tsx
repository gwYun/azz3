"use client";

import { useState, useEffect, useRef } from "react";
import { useT } from "@/lib/i18n-context";

type Props = {
  defaultName: string;
  onSave: (name: string) => void;
  disabled?: boolean;
};

/**
 * D4 — inline name field replacing the button. Esc cancels, Enter submits.
 * Smart pre-fill comes from `defaultName` (computed by lib/storage.suggestName).
 */
export function SaveBuildButton({ defaultName, onSave, disabled }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setName(defaultName);
      // Microtask: wait for the input to mount.
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [editing, defaultName]);

  if (!editing) {
    return (
      <button
        type="button"
        className="btn-primary"
        onClick={() => setEditing(true)}
        disabled={disabled}
      >
        {t("build.save.button")}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const final = name.trim() || defaultName;
        onSave(final);
        setEditing(false);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="input-text w-56"
        placeholder={t("build.save.placeholder")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        maxLength={60}
      />
      <button type="submit" className="btn-primary">
        {t("build.save.submit")}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
        {t("build.save.cancel")}
      </button>
    </form>
  );
}
