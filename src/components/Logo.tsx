// The Campus OS mark (the app icon's cap, in black, white in dark mode)
// and wordmark.

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center rounded-[9px] bg-ink text-surface"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.64} height={size * 0.64} fill="currentColor">
        <path d="M12 5 2.5 9.2 12 13.4l9.5-4.2z" />
        <path d="M6.5 11.3v3.4c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-3.4L12 13.8z" />
        <path d="M20.2 9.8v4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Campus OS</span>
    </span>
  );
}
