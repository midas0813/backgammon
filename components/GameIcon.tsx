/**
 * One line-icon set for games and Arena features, so tiles, badges and tags share a visual style
 * (24px grid, 1.8 stroke, round joins; dice pips and accents filled).
 */
export type IconName = "backgammon" | "chess" | "poker" | "cribbage" | "checkers" | "trophy" | "games" | "computer";

const Pip = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r="1.05" fill="currentColor" stroke="none" />;

const PATHS: Record<IconName, React.ReactNode> = {
  // Two standard six-sided dice showing five and three.
  backgammon: (
    <>
      <g transform="rotate(-10 8 14.5)">
        <rect x="2.5" y="9" width="11" height="11" rx="2.6" />
        <Pip x={5.4} y={11.9} />
        <Pip x={10.6} y={11.9} />
        <Pip x={8} y={14.5} />
        <Pip x={5.4} y={17.1} />
        <Pip x={10.6} y={17.1} />
      </g>
      <g transform="rotate(12 16.5 8)">
        <rect x="12" y="3.5" width="9" height="9" rx="2.2" />
        <Pip x={14.4} y={5.9} />
        <Pip x={16.5} y={8} />
        <Pip x={18.6} y={10.1} />
      </g>
    </>
  ),
  chess: (
    <>
      <path d="M6.5 21h11" />
      <path d="M8.5 21c0-3.4 1.6-5.4 4-6.8-1.7-.3-3.4.3-4.7 1.5L6.4 13.8l3.3-5.2c.4-2.4 1.8-4.2 3.8-4.8l1-1.8 1 2.1c2.3 1.1 3.6 3.7 3.6 7.3V21" />
      <circle cx="12.4" cy="8.3" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  poker: (
    <>
      <rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-12 8.5 12.5)" />
      <rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15.5 11.5)" />
      <path
        d="M15.6 8.6c1.6 1.5 3 2.6 3 3.9a1.6 1.6 0 0 1-3 .7 1.6 1.6 0 0 1-3-.7c0-1.3 1.4-2.4 3-3.9zM15.6 13.2l-.6 1.9h1.2z"
        fill="currentColor"
        strokeWidth="1"
      />
    </>
  ),
  cribbage: (
    <>
      <rect x="2.5" y="8" width="19" height="9" rx="4.5" />
      {[6, 9.5, 13, 16.5].map((x) => (
        <Pip key={x} x={x} y={11} />
      ))}
      {[6, 9.5, 13].map((x) => (
        <Pip key={x} x={x} y={14} />
      ))}
      <path d="M17 14v-9" />
      <circle cx="17" cy="4.2" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  checkers: (
    <>
      <ellipse cx="12" cy="8" rx="8" ry="3.2" />
      <path d="M4 8v3.5c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V8" />
      <path d="M4 12.5V16c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-3.5" />
      <ellipse cx="12" cy="8" rx="3.6" ry="1.3" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5a3 3 0 0 0 3.2 4.3M16.5 6h3a3 3 0 0 1-3.2 4.3" />
      <path d="M12 13.5V17M8.5 20.5h7M9.5 20.5c0-2 1.1-3.5 2.5-3.5s2.5 1.5 2.5 3.5" />
    </>
  ),
  games: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  computer: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 7V4M9 19v2M15 19v2" />
      <circle cx="12" cy="3.3" r="1" fill="currentColor" stroke="none" />
      <Pip x={9} y={12.5} />
      <Pip x={15} y={12.5} />
      <path d="M9.5 15.6h5" />
    </>
  ),
};

export default function GameIcon({ name, size = 22, className }: { name: IconName | string; size?: number; className?: string }) {
  const body = PATHS[name as IconName] ?? PATHS.games;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {body}
    </svg>
  );
}
