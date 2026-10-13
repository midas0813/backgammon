import { BRAND } from "@/lib/brand";

/** Logo mark: a stylised point pair with a checker and a die pip. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7EF0CC" />
          <stop offset="1" stopColor="#F4CF87" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#101A2E" stroke="url(#bm-g)" strokeWidth="1.5" />
      <path d="M6 5 L11 17 L16 5 Z" fill="#F4CF87" opacity="0.9" />
      <path d="M16 27 L21 15 L26 27 Z" fill="#65E2BC" opacity="0.9" />
      <circle cx="21.5" cy="9" r="4" fill="#F7F1E6" stroke="#CDBF9F" />
      <circle cx="10.5" cy="23" r="4" fill="#101A2E" stroke="#61758B" />
    </svg>
  );
}

export function Brand() {
  return (
    <>
      <BrandMark />
      <span>{BRAND.name}</span>
    </>
  );
}
