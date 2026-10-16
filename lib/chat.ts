/** Chat phrases and reactions offered in matches (shared by the server rules and the chat panel). */
export const PRESETS: Record<string, string> = {
  gl: "Good luck!",
  hf: "Have fun!",
  nice: "Nice roll!",
  wp: "Well played",
  oops: "Oops!",
  thanks: "Thanks!",
  gg: "Good game",
};

/** The quick-reaction row; any other emoji can be picked from the full (animated) picker. */
export const REACTIONS = ["👏", "🔥", "😂", "😮", "❤️", "👍", "🎉", "🎲", "😎", "🤯", "😭", "🙏"];

/** One emoji (with skin tones, variation selectors and joiners), as reactions are sent. */
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
export const isEmoji = (s: string) => s.length > 0 && s.length <= 16 && EMOJI_RE.test(s) && /\p{Extended_Pictographic}/u.test(s);

/** "❤️" → "2764_fe0f": the code used by Google's animated Noto emoji. */
export const emojiCode = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16)).join("_");
/** "2764_fe0f" → "❤️". */
export const emojiFromCode = (code: string) => String.fromCodePoint(...code.split("_").map((h) => parseInt(h, 16)));

export const CHAT_MAX = 200;
