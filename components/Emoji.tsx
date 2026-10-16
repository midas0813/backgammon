"use client";

import dynamic from "next/dynamic";
import { emojiCode } from "@/lib/chat";

/**
 * An animated emoji (Google's Noto animated emoji via @zolaha/react-noto-animated-emoji). The player
 * engine needs the browser, so it loads there only; the plain emoji shows meanwhile and for emojis
 * without an animation.
 */
const Animated = dynamic(() => import("@zolaha/react-noto-animated-emoji").then((m) => m.AnimatedEmoji), { ssr: false });

let supported: Set<string> | null = null;
if (typeof window !== "undefined") void import("@zolaha/react-noto-animated-emoji").then((m) => (supported = m.supportedEmojis)).catch(() => {});

export default function Emoji({
  char,
  size = 32,
  loop = false,
  replayOnHover = false,
}: {
  char: string;
  size?: number;
  loop?: boolean | number;
  replayOnHover?: boolean;
}) {
  const code = emojiCode(char);
  const plain = (
    <span className="emoji-plain" style={{ fontSize: size * 0.82, width: size, height: size }} aria-hidden>
      {char}
    </span>
  );
  if (supported && !supported.has(code)) return plain;
  return <Animated unified={code} size={size} loop={loop} replayOnHover={replayOnHover} fallback={plain} />;
}

/** The full picker (hundreds of animated emojis, searchable). */
export const EmojiPicker = dynamic(() => import("@zolaha/react-noto-animated-emoji").then((m) => m.AnimateEmojiModal), { ssr: false });
