"use client";

import ErrorScreen from "@/components/ErrorScreen";
import "./globals.css";
import "./app.css";

/** Replaces the root layout when it fails, so it brings its own <html> and <body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
