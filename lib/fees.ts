/**
 * Fee policy (spec 02-backend "Fees"). All amounts are integer minor units: TOKEN_SCALE units = 1 token = $1 USD.
 * The $10 boundary and the fee base are PROPOSED, not owner-approved; paid play stays disabled until they are.
 */
export const TOKEN_SCALE = 100;

export const FEE_POLICY = {
  version: "fee-proposed-1",
  approved: false,
  // Full-tier (non-marginal) rates in basis points.
  tiers: [
    { upToInclusive: 10 * TOKEN_SCALE, bps: 1000 }, // V <= $10 → 10%
    { below: 500 * TOKEN_SCALE, bps: 500 }, // $10 < V < $500 → 5%
    { atLeast: 500 * TOKEN_SCALE, bps: 250 }, // V >= $500 → 2.5% (owner-confirmed)
  ],
  rounding: "half-up-minor-unit",
} as const;

export function feeRateBps(valueUnits: number): number {
  if (!Number.isInteger(valueUnits) || valueUnits < 0) throw new Error("Fee base must be a non-negative integer");
  if (valueUnits <= 10 * TOKEN_SCALE) return 1000;
  if (valueUnits < 500 * TOKEN_SCALE) return 500;
  return 250;
}

/** F = rate(V) × V, rounded half-up to the minor unit. */
export function computeFee(valueUnits: number): number {
  const bps = feeRateBps(valueUnits);
  return Math.floor((valueUnits * bps + 5000) / 10000);
}

export const formatTokens = (units: number) => (units / TOKEN_SCALE).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
