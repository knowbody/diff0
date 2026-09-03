"use client";

import { useRef, useState } from "react";

export default function CopyButton({
  text,
  label = "Copy command",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 font-mono text-xs text-muted transition-colors hover:text-fg"
    >
      <span aria-live="polite">{copied ? "copied" : "copy"}</span>
    </button>
  );
}
