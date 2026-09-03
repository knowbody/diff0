"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsToClassName, hasRowMarker, type Span } from "./TerminalPanel";

/**
 * Line-by-line replay of the real diff0 terminal render.
 *
 * The FULL transcript is server-rendered (revealed = all lines), so the
 * content is always in the HTML: no JS and prefers-reduced-motion both get
 * the complete static panel. The animation only progressively re-reveals.
 *
 * Hierarchy: exactly three key lines (verdict, subagent drift, cost) carry
 * the drift yellow; every other line drops one shade. The per-run raw
 * summaries collapse behind a native <details> (no JS needed to expand).
 * The transcript text itself is byte-verbatim; this is presentation only.
 */
/** One shade down for every non-money line: contrast only, size untouched. */
const DIM = 0.62;

export default function Beat3Replay({
  lines,
  prompt,
  title,
}: {
  lines: Span[][];
  prompt: string;
  title: string;
}) {
  const total = lines.length + 1; // +1 for the prompt line
  const [revealed, setRevealed] = useState(total);
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const playedOnce = useRef(false);

  // Collapse boundaries: PER-RUN RAW SUMMARIES up to (excluding) the
  // statistical footer. The blank line before the footer stays visible.
  const { collapseStart, collapseEnd } = useMemo(() => {
    const perRun = lines.findIndex((l) =>
      l.some((s) => s.text.includes("PER-RUN RAW SUMMARIES")),
    );
    const stat = lines.findIndex((l) =>
      l.some((s) => s.text.startsWith("Statistical comparison")),
    );
    if (perRun === -1 || stat === -1 || stat <= perRun) {
      return { collapseStart: -1, collapseEnd: -1 };
    }
    return { collapseStart: perRun, collapseEnd: stat - 1 };
  }, [lines]);

  const isYellowLine = useCallback(
    (i: number) =>
      i > 0 && lines[i - 1].some((s) => s.cls?.includes("yellow")),
    [lines],
  );

  const play = useCallback(() => {
    window.clearTimeout(timer.current);
    setPlaying(true);
    setRevealed(1); // prompt line first
    let i = 1;
    const step = () => {
      i += 1;
      setRevealed(i);
      if (i >= total) {
        setPlaying(false);
        return;
      }
      // Terminal pace: quick for ordinary lines, a beat before verdict and
      // drift lines so the yellow lands.
      const next = isYellowLine(i) ? 340 : 55;
      timer.current = window.setTimeout(step, next);
    };
    timer.current = window.setTimeout(step, 420);
  }, [total, isYellowLine]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = rootRef.current;
    if (!el || playedOnce.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !playedOnce.current) {
          playedOnce.current = true;
          io.disconnect();
          play();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer.current);
    };
  }, [play]);

  const renderLine = (spans: Span[], i: number) => {
    const shown = i + 1 < revealed;
    const justLanded =
      playing && shown && i + 1 === revealed - 1 && isYellowLine(i + 1);
    const money = hasRowMarker(spans, "money");
    // The reveal opacity is inline, so the one-shade dim for non-money
    // lines must be folded into it (an inline style beats any class).
    return (
      <div
        // biome-ignore lint: static ordered transcript
        key={i}
        className={`term-line${justLanded ? " landed-yellow" : ""}`}
        style={{ opacity: shown ? (money ? 1 : DIM) : 0 }}
      >
        {spans.map((s, j) => (
          // biome-ignore lint: span order is stable
          <span key={j} className={clsToClassName(s.cls)}>
            {s.text}
          </span>
        ))}
      </div>
    );
  };

  const flat = collapseStart === -1;
  const head = flat ? lines : lines.slice(0, collapseStart);
  const collapsed = flat ? [] : lines.slice(collapseStart, collapseEnd);
  const tail = flat ? [] : lines.slice(collapseEnd);

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-md border border-term-line bg-term-bg"
    >
      <div className="flex items-center gap-2 border-b border-term-line px-4 py-2.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-term-line" />
          <span className="h-2 w-2 rounded-full bg-term-line" />
          <span className="h-2 w-2 rounded-full bg-term-line" />
        </span>
        <span className="ml-1 truncate font-mono text-xs text-term-dim">
          {title}
        </span>
        <button
          type="button"
          onClick={() => {
            playedOnce.current = true;
            play();
          }}
          className="ml-auto rounded-md border border-term-line px-2 py-0.5 font-mono text-xs text-term-dim transition-colors hover:text-term-fg"
        >
          replay
        </button>
      </div>
      <div className="overflow-x-auto">
        <pre className="min-w-max px-4 py-4 font-mono text-[13px] leading-6 text-term-fg">
          <div
            className="term-line"
            style={{ opacity: revealed > 0 ? 1 : 0 }}
          >
            <span className="t-dim">$ </span>
            {prompt}
          </div>
          {head.map((spans, i) => renderLine(spans, i))}
          {flat ? null : (
            <details className="term-details">
              <summary
                style={{ opacity: revealed > collapseStart ? 1 : 0 }}
              >
                show full output
              </summary>
              {collapsed.map((spans, i) => renderLine(spans, collapseStart + i))}
            </details>
          )}
          {tail.map((spans, i) => renderLine(spans, collapseEnd + i))}
        </pre>
      </div>
    </div>
  );
}
