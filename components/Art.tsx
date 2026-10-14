import fs from "node:fs";
import path from "node:path";
import { ART, type ArtKey } from "@/lib/art";
import SceneArt from "@/components/SceneArt";

/** Server component: the AI image if /public/images/<file> exists, otherwise the built-in SVG scene. */
export function artExists(key: ArtKey): boolean {
  return fs.existsSync(path.join(process.cwd(), "public", "images", ART[key].file));
}

export default function Art({
  k,
  className,
  priority,
  position = "center",
}: {
  k: ArtKey;
  className?: string;
  priority?: boolean;
  /** CSS object-position: which part of the image survives cropping on narrow screens. */
  position?: string;
}) {
  const slot = ART[k];
  if (artExists(k)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className}
        src={`/images/${slot.file}`}
        alt={slot.alt}
        width={slot.width}
        height={slot.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        style={{ objectFit: "cover", objectPosition: position, width: "100%", height: "100%" }}
      />
    );
  }
  return <SceneArt variant={slot.fallback} className={className} label={slot.alt} />;
}
