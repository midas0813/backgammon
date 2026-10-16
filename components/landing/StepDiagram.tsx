/**
 * Small, rules-accurate diagrams for the "How to play" steps. Drawn in code (not AI) so the
 * positions are correct.
 */
const CREAM = "#F7F1E6";
const INK = "#101A2E";

function Tri({ x, up, light }: { x: number; up?: boolean; light?: boolean }) {
  const base = up ? 150 : 10;
  const tip = up ? 70 : 90;
  return <polygon points={`${x},${base} ${x + 30},${base} ${x + 15},${tip}`} fill={light ? "#EAD7B5" : "#5B3E31"} />;
}
function C({ x, y, dark, ghost, cls }: { x: number; y: number; dark?: boolean; ghost?: boolean; cls?: string }) {
  return (
    <circle
      className={cls}
      cx={x}
      cy={y}
      r={13}
      fill={ghost ? "none" : dark ? INK : CREAM}
      stroke={ghost ? "#65E2BC" : dark ? "#61758B" : "#CDBF9F"}
      strokeWidth={ghost ? 2.5 : 2}
      strokeDasharray={ghost ? "4 3" : undefined}
    />
  );
}
function Label({ x, y, text, color = "#EDF3F9" }: { x: number; y: number; text: string; color?: string }) {
  const w = text.length * 6.6 + 14;
  return (
    <g>
      <rect x={x - w / 2} y={y - 12} width={w} height={17} rx={8.5} fill="#0B1220" opacity={0.82} />
      <text x={x} y={y + 1} fill={color} fontSize={11} fontWeight={700} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function Die({ x, y, v }: { x: number; y: number; v: number }) {
  const p: Record<number, [number, number][]> = {
    3: [
      [6, 6],
      [13, 13],
      [20, 20],
    ],
    4: [
      [7, 7],
      [19, 7],
      [7, 19],
      [19, 19],
    ],
    5: [
      [6, 6],
      [20, 6],
      [13, 13],
      [6, 20],
      [20, 20],
    ],
    6: [
      [7, 6],
      [19, 6],
      [7, 13],
      [19, 13],
      [7, 20],
      [19, 20],
    ],
  };
  return (
    <g className="die-bounce">
      <rect x={x} y={y} width={26} height={26} rx={5} fill={CREAM} stroke="#CDBF9F" />
      {p[v].map(([a, b], i) => (
        <circle key={i} cx={x + a} cy={y + b} r={2.4} fill={INK} />
      ))}
    </g>
  );
}

export default function StepDiagram({ step }: { step: "roll" | "move" | "hit" | "off" }) {
  return (
    <svg viewBox="0 0 240 160" className="step-svg" aria-hidden>
      <rect width="240" height="160" rx="14" fill="#7A5A3B" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <g key={i}>
          <Tri x={8 + i * 32} light={i % 2 === 1} />
          <Tri x={8 + i * 32} up light={i % 2 === 0} />
        </g>
      ))}
      {step === "roll" && (
        <>
          <Die x={84} y={66} v={6} />
          <Die x={124} y={66} v={4} />
          <C x={23} y={136} />
          <C x={23} y={110} />
          <C x={215} y={24} dark />
        </>
      )}
      {step === "move" && (
        <>
          <C x={23} y={136} />
          <C x={183} y={136} ghost cls="pulse-soft" />
          <path d="M23 118 Q100 60 183 118" fill="none" stroke="#65E2BC" strokeWidth={2.5} strokeDasharray="5 5" className="dash-flow" />
          <Label x={103} y={56} text="6 + 4 = 10 pips" />
        </>
      )}
      {step === "hit" && (
        <>
          <C x={87} y={136} dark cls="knock" />
          <C x={151} y={136} dark />
          <C x={151} y={110} dark />
          <C x={55} y={136} cls="slide-in" />
          <Label x={151} y={88} text="blocked" />
          <Label x={87} y={100} text="hit!" color="#F4CF87" />
        </>
      )}
      {step === "off" && (
        <>
          <C x={23} y={136} />
          <C x={55} y={136} />
          <C x={55} y={110} />
          <rect x={214} y={84} width={20} height={70} rx={4} fill="#5B3E31" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={216} y={142 - i * 9} width={16} height={7} rx={2} fill={CREAM} className="stack-in" style={{ animationDelay: `${i * 0.25}s` }} />
          ))}
        </>
      )}
    </svg>
  );
}
