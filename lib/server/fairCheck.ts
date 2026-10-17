import { rollsFromEvents } from "../fair";
import { notFound } from "./errors";
import { fairView } from "./fair";
import { tx } from "./store";

/** Everything needed to check a match's dice (secret included once it is over). Public. */
export function fairRecord(matchId: string) {
  return tx(async (t) => {
    const rec = await t.matches.get(matchId);
    if (!rec || !rec.fair) throw notFound("Match");
    const over = rec.state.status !== "WAITING" && rec.state.status !== "ACTIVE";
    return {
      matchId: rec.id,
      status: rec.state.status,
      names: rec.names,
      fair: fairView(rec.fair, over)!,
      dice: rollsFromEvents(await t.matches.events(matchId, {})),
    };
  });
}

export type FairRecord = Awaited<ReturnType<typeof fairRecord>>;
