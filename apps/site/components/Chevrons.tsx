/** A single row of stitch chevrons: the one permitted divider. Decorative. */
export function ChevronRow({ count = 7, className = "" }: { count?: number; className?: string }) {
  const w = 22;
  return (
    <svg className={`chevron-row ${className}`} width={count * w} height="14" viewBox={`0 0 ${count * w} 14`} aria-hidden="true" focusable="false">
      {Array.from({ length: count }, (_, i) => (
        <path key={i} d={`M${i * w + 3} 2 L${i * w + w / 2} 11 L${i * w + w - 3} 2`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** A tiled chevron field, used behind large ember sections. Decorative. */
export function ChevronField({ className = "" }: { className?: string }) {
  return (
    <svg className={`chevron-field ${className}`} width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="chev" width="48" height="36" patternUnits="userSpaceOnUse">
          <path d="M6 6 L24 22 L42 6" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chev)" />
    </svg>
  );
}
