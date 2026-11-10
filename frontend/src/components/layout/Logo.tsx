export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} shrink-0 text-ink`} aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="22.5" cy="8.5" r="3" style={{ fill: "var(--color-ice)" }} />
    </svg>
  );
}
