"use client";

import Link from "next/link";
import { useMe } from "@/lib/client/me";

/** Landing-page CTA: returning players see "Open app"; everyone lands on Home, not back here. */
export default function OpenAppLink({ className, label }: { className: string; label: string }) {
  const me = useMe();
  return (
    <Link className={className} href="/home">
      {me?.registered ? "Open app" : label}
    </Link>
  );
}
