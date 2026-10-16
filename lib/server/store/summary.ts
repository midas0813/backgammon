import type { LobbyRow, MatchRecord } from "./types";

/** The lobby fields of a match, stored beside the document so lists never load it. */
export function summarize(m: MatchRecord) {
  return {
    names: m.names,
    score: m.state.score,
    cube: m.state.game?.cubeValue ?? 1,
    gameNumber: m.state.game?.gameNumber ?? 0,
    hostId: m.createdBy,
    seats: m.seats,
  };
}

export function lobbyRow(m: MatchRecord, hostSeenAt: number, spectators: number): LobbyRow {
  const s = summarize(m);
  return {
    id: m.id,
    mode: m.mode,
    status: m.state.status,
    targetPoints: m.state.targetPoints,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? Date.parse(m.createdAt),
    hostId: s.hostId,
    seats: s.seats,
    names: s.names,
    score: s.score,
    cube: s.cube,
    gameNumber: s.gameNumber,
    allowSpectators: m.allowSpectators !== false,
    entryFee: m.entryFee ?? 0,
    hostSeenAt,
    spectators,
  };
}
