"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import Modal from "@/components/Modal";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

/** "Feedback" from any screen: an idea, a bug or anything else, straight to the admin area. */
export default function FeedbackButton({ className = "btn sm ghost" }: { className?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"idea" | "bug" | "other">("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/api/feedback", { method: "POST", body: { kind, message, path: pathname } });
      toast("Thanks — your feedback reached the team.", { tone: "ok" });
      setMessage("");
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open && (
        <Modal title="Send feedback" onClose={() => setOpen(false)}>
          <div className="seg compact" role="group" aria-label="Kind">
            {(
              [
                ["idea", "Idea"],
                ["bug", "Problem"],
                ["other", "Other"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className="chip" aria-pressed={kind === id} onClick={() => setKind(id)}>
                {label}
              </button>
            ))}
          </div>
          <label>
            {kind === "bug" ? "What happened, and what did you expect?" : "Tell us"}
            <textarea rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <p className="muted small">We also note the page you&apos;re on ({pathname}) and your browser, to help us find problems.</p>
          <div className="grid2">
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || message.trim().length < 3} onClick={send}>
              Send
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
