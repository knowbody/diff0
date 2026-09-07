export default function Principles() {
  return (
    <section className="border-b border-line" aria-label="Product principles">
      <div className="mx-auto grid max-w-[1240px] grid-cols-2 divide-x divide-line px-5 sm:px-8 md:grid-cols-4">
        {[
          ["Eve-native", "Reads captured Eve eval JSON and events"],
          ["Two refs", "Base behavior vs. head behavior"],
          ["N runs", "Evidence, not anecdotes"],
          ["One comment", "The result lives in your PR"],
        ].map(([title, copy]) => (
          <div key={title} className="py-6 pr-4 pl-4 first:pl-0 md:px-6 md:first:pl-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
