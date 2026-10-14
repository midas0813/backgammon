import { ViewTransition } from "react";

/**
 * Directional slide between app sections (tab order: Home → Lobby → Wallet → Profile; a match is
 * "deeper" than the lobby). Links tag navigations with nav-forward / nav-back; other navigations
 * (browser back, refresh) only crossfade. Browsers without view transitions just swap content.
 */
export default function TabTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
