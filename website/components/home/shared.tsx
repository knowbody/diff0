import CopyButton from "@/components/CopyButton";

export function Mark() {
  return (
    <span
      role="img"
      aria-label="diff0"
      className="inline-flex items-center font-mono text-xl leading-none font-medium tracking-[-0.06em]"
    >
      <span aria-hidden="true">diff</span>
      <svg className="ml-px h-4 w-3" viewBox="14 8 36 48" fill="none" aria-hidden="true">
        <rect x="18" y="12" width="28" height="40" rx="14" stroke="currentColor" strokeWidth="5" />
        <path d="M23 43L41 21" stroke="currentColor" strokeWidth="5" />
      </svg>
    </span>
  );
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={diagonal ? "M3 11L11 3M5 3h6v6" : "M2 7h10m-3-3 3 3-3 3"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Eyebrow({
  children,
  centered = false,
}: {
  children: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <p
      className={`mb-5 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.16em] text-muted uppercase ${centered ? "justify-center" : "justify-start"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {children}
    </p>
  );
}

export function Command({ command, inverse = false }: { command: string; inverse?: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-xl border py-2 pr-2 pl-4 sm:rounded-full ${
        inverse
          ? "border-white/15 bg-white/[0.06] text-white"
          : "border-line bg-card text-fg shadow-[0_1px_0_rgba(0,0,0,0.03)]"
      }`}
    >
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-5 whitespace-pre-wrap sm:whitespace-nowrap">
        <span className={inverse ? "text-white/60" : "text-muted"}>$ </span>
        {command}
      </code>
      <CopyButton text={command} inverse={inverse} />
    </div>
  );
}

export function ResultRow({
  label,
  from,
  to,
  tone = "neutral",
}: {
  label: string;
  from: string;
  to: string;
  tone?: "neutral" | "warning" | "good";
}) {
  const toneClass =
    tone === "warning"
      ? "text-panel-warning"
      : tone === "good"
        ? "text-panel-success"
        : "text-white/70";
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-white/10 py-3.5 font-mono text-[11px] sm:grid-cols-[1fr_88px_88px] sm:text-xs">
      <span className={toneClass}>{label}</span>
      <span className="text-right text-white/60">{from}</span>
      <span className="text-right text-white">{to}</span>
    </div>
  );
}
