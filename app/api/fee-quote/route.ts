import type { NextRequest } from "next/server";
import { computeFee, feeRateBps, FEE_POLICY, TOKEN_SCALE } from "@/lib/fees";

/** GET /api/fee-quote?base=<tokens> — illustrative only; policy is not approved, paid play is disabled. */
export async function GET(req: NextRequest) {
  const tokens = Number(req.nextUrl.searchParams.get("base") ?? "0");
  const units = Math.max(0, Math.round(tokens * TOKEN_SCALE));
  return Response.json({
    policyVersion: FEE_POLICY.version,
    approved: FEE_POLICY.approved,
    base: { units, scale: TOKEN_SCALE, tokenCode: "BGT" },
    rateBps: feeRateBps(units),
    fee: { units: computeFee(units), scale: TOKEN_SCALE, tokenCode: "BGT" },
  });
}
