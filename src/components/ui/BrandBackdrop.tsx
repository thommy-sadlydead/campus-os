// The soft blue-and-orange glow behind the public pages (landing, log in,
// not found). Purely decorative.
export function BrandBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0"
      style={{
        background:
          "radial-gradient(55% 50% at 25% 0%, var(--halo-1), transparent 72%), radial-gradient(50% 45% at 78% 6%, var(--halo-2), transparent 72%)",
      }}
    />
  );
}
