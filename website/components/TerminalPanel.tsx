import type { ReactNode } from "react";

/**
 * Shared terminal chrome. Dark in both themes. The inner <pre> scrolls
 * horizontally on narrow screens so transcript lines never wrap into soup.
 */
export default function TerminalPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-term-line bg-term-bg">
      <div className="flex items-center gap-2 border-b border-term-line px-4 py-2.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-term-line" />
          <span className="h-2 w-2 rounded-full bg-term-line" />
          <span className="h-2 w-2 rounded-full bg-term-line" />
        </span>
        <span className="ml-1 truncate font-mono text-xs text-term-dim">
          {title}
        </span>
      </div>
      <div className="overflow-x-auto">
        <pre className="min-w-max px-4 py-4 font-mono text-[13px] leading-6 text-term-fg">
          {children}
        </pre>
      </div>
    </div>
  );
}

export type Span = { text: string; cls: string | null };

/** cls tokens that style the whole row, not the span. */
const ROW_MARKERS = new Set(["delrow", "money"]);

export function clsToClassName(cls: string | null): string | undefined {
  if (!cls) return undefined;
  const names = cls
    .split(" ")
    .filter((c) => !ROW_MARKERS.has(c))
    .map((c) => (c === "bold" ? "t-bold" : `t-${c}`));
  return names.length > 0 ? names.join(" ") : undefined;
}

export function hasRowMarker(spans: Span[], marker: string): boolean {
  return spans.some((s) => s.cls?.split(" ").includes(marker));
}

/** Static (server-rendered) transcript body from span lines. */
export function TranscriptLines({
  lines,
  prompt,
}: {
  lines: Span[][];
  prompt?: string;
}) {
  return (
    <>
      {prompt ? (
        <div className="term-line">
          <span className="t-dim">$ </span>
          {prompt}
        </div>
      ) : null}
      {lines.map((spans, i) => (
        // biome-ignore lint: transcript lines are a static ordered list
        <div
          key={i}
          className={`term-line${hasRowMarker(spans, "delrow") ? " term-delrow" : ""}`}
        >
          {spans.map((s, j) => (
            // biome-ignore lint: span order is stable
            <span key={j} className={clsToClassName(s.cls)}>
              {s.text}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
