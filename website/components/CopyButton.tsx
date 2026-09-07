"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

export default function CopyButton({
  text,
  label = "Copy command",
  inverse = false,
}: {
  text: string;
  label?: string;
  inverse?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  const attempt = useRef(0);

  useEffect(
    () => () => {
      // Also discard a clipboard request that resolves after unmount.
      attempt.current++;
      window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    const current = ++attempt.current;
    window.clearTimeout(timer.current);
    const copied = await copyText(text);
    if (attempt.current !== current) return;
    setStatus(copied ? "copied" : "failed");
    timer.current = window.setTimeout(() => setStatus("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={
        status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed. Try again or select the text to copy it manually."
            : label
      }
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-xs transition-colors ${inverse ? "border-white/25 text-white/75 hover:border-white/50 hover:text-white" : "border-line text-muted hover:text-fg"}`}
    >
      <span aria-live="polite">
        {status === "copied" ? "copied" : status === "failed" ? "copy failed" : "copy"}
      </span>
    </button>
  );
}
