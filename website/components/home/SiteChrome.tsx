import ThemeToggle from "@/components/ThemeToggle";
import { GITHUB, X } from "./links";
import { Arrow, Mark } from "./shared";

export function SiteHeader() {
  return (
    <header className="relative z-20 border-b border-line bg-bg/90 backdrop-blur-xl">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8"
      >
        <a href="#top" className="rounded-sm">
          <Mark />
        </a>
        <div className="hidden items-center gap-7 text-sm text-muted md:flex">
          <a className="transition-colors hover:text-fg" href="#product">
            Product
          </a>
          <a className="transition-colors hover:text-fg" href="#workflow">
            How it works
          </a>
          <a className="transition-colors hover:text-fg" href="#evidence">
            Evidence
          </a>
          <a className="transition-colors hover:text-fg" href="#quickstart">
            Quickstart
          </a>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href={GITHUB}
            className="group inline-flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5"
          >
            GitHub <Arrow diagonal />
          </a>
        </div>
      </nav>
      <nav
        aria-label="Section navigation"
        className="flex gap-5 overflow-x-auto border-t border-line px-5 py-2.5 text-xs text-muted md:hidden"
      >
        <a className="shrink-0" href="#product">
          Product
        </a>
        <a className="shrink-0" href="#workflow">
          How it works
        </a>
        <a className="shrink-0" href="#evidence">
          Evidence
        </a>
        <a className="shrink-0" href="#quickstart">
          Quickstart
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto_auto] md:items-end md:gap-16">
        <div>
          <Mark />
          <p className="mt-4 max-w-[330px] text-xs leading-5 text-muted">
            Behavioral diffs for Eve agents. Open source and MIT licensed.
          </p>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-xs text-muted">Product</p>
          <div className="flex flex-col gap-2">
            <a href="#workflow" className="hover:text-muted">
              How it works
            </a>
            <a href="#evidence" className="hover:text-muted">
              Evidence
            </a>
            <a href="#quickstart" className="hover:text-muted">
              Quickstart
            </a>
          </div>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-xs text-muted">Elsewhere</p>
          <div className="flex flex-col gap-2">
            <a href={GITHUB} className="hover:text-muted">
              GitHub
            </a>
            <a href={X} className="hover:text-muted">
              X / Twitter
            </a>
            <a href="https://eve.dev" className="hover:text-muted">
              Eve
            </a>
          </div>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1240px] items-center justify-between border-t border-line px-5 py-5 text-[11px] text-muted sm:px-8">
        <span>© 2026 diff0</span>
        <span>Built for agents that change.</span>
      </div>
    </footer>
  );
}
