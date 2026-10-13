/** Avatar image, or initials on a colour derived from the name when no image is uploaded. */
const PALETTE = [
  ["#65E2BC", "#2FA987"],
  ["#F4CF87", "#D9A654"],
  ["#9DB7FF", "#5F7FE0"],
  ["#FFA8B6", "#E06C80"],
  ["#C7A6FF", "#8E63E6"],
  ["#8EE3F5", "#3BAFC8"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ name, src, size = 40, bot }: { name: string; src?: string | null; size?: number; bot?: boolean }) {
  const [a, b] = PALETTE[hash(name) % PALETTE.length];
  const initials =
    name
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "?";
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `linear-gradient(135deg, ${a}, ${b})` }}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} />
      ) : bot ? (
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#0B1220" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" />
        </svg>
      ) : (
        initials
      )}
    </span>
  );
}
