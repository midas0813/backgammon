import { CUBE_CAP, RULES_VERSION } from "@/lib/engine/match";
import { FEE_POLICY } from "@/lib/fees";
import { THEME_IDS } from "@/lib/server/users";

export async function GET() {
  return Response.json({
    rulesVersion: RULES_VERSION,
    enabledFormats: ["FREE"],
    disabledFormats: {
      FIXED_STAKE_POINT_MATCH: "Phase 3 — awaiting fee basis, territories and provider approval",
      TOKENS_PER_POINT: "Phase 3 — awaiting exposure model and fee basis approval",
      TOURNAMENT: "Phase 2",
      RANKED: "Phase 2",
    },
    matchLengths: [1, 3, 5, 7],
    cubeCap: CUBE_CAP,
    themeIds: THEME_IDS,
    feePolicy: FEE_POLICY,
  });
}
