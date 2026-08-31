export function Logo({ size = 56 }: { size?: number }) {
  return (
    <div className="logo">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <path d="M76 9 C40 18 8 55 13 93 C28 72 58 50 76 9 Z" fill="#fff" />
        <path d="M78 12 L94 9 L79 94 L64 96 Z" fill="#fff" fillOpacity="0.55" />
        <path d="M18 66 L97 38 L97 56 L18 84 Z" fill="#fff" />
      </svg>
    </div>
  );
}
