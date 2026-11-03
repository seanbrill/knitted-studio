/** The mark: two interlocking V chevrons on an ember tile. Drawn as SVG, so it needs no image file. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#df5a0f" />
      <path d="M7 8.5 16 17.5 25 8.5" fill="none" stroke="#1a0e05" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 15.5 16 24.5 25 15.5" fill="none" stroke="#df5a0f" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 15.5 16 24.5 25 15.5" fill="none" stroke="#1a0e05" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The type wordmark: knitted in Bricolage 800, .studio in mono at about 40%. */
export function Wordmark() {
  return (
    <span className="wordmark">
      knitted<span className="wordmark-sub">.studio</span>
    </span>
  );
}
