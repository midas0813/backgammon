"use client";

/** A full-width play option with its artwork (or a large symbol) behind the text. */
export default function PlayTile({
  image,
  glyph,
  title,
  text,
  onClick,
  busy,
  primary,
  badge,
}: {
  /** Artwork in /images/play (…-sm.webp and …-lg.webp). */
  image?: string;
  /** Until a game has artwork: a large symbol on a gradient. */
  glyph?: string;
  title: string;
  text: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <button className={`play-tile${primary ? " primary" : ""}`} onClick={onClick} disabled={busy}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="play-tile-img"
          src={`/images/play/${image}-lg.webp`}
          srcSet={`/images/play/${image}-sm.webp 640w, /images/play/${image}-lg.webp 1200w`}
          sizes="(max-width: 680px) 100vw, 640px"
          alt=""
          draggable={false}
        />
      ) : (
        <span className="play-tile-img play-tile-glyph" aria-hidden>
          {glyph}
        </span>
      )}
      <span className="play-tile-shade" aria-hidden />
      <span className="play-tile-text">
        {badge}
        <strong>{busy ? "Starting…" : title}</strong>
        <span>{text}</span>
      </span>
      <svg
        className="play-tile-arrow"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
