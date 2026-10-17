export const metadata = { title: "Cookies" };

export default function Cookies() {
  return (
    <article className="card legal-doc">
      <h1>Cookies and storage</h1>
      <p>We use only what the Service needs to work. There are no advertising or analytics cookies, so there is nothing to opt out of.</p>
      <ul>
        <li>
          <strong>bg_sid</strong> (cookie): keeps you signed in (or remembers your guest profile). Essential.
        </li>
        <li>
          <strong>bg_admin</strong> (cookie, admins only): the admin session; ends after 30 idle minutes.
        </li>
        <li>
          <strong>Browser storage</strong> on your device only: your theme and sound settings, muted spectators, dismissed announcements, your invite code and
          the wallet connection your wallet app remembers.
        </li>
      </ul>
      <p>You can clear them in your browser settings; you will then be signed out and appear as a new guest.</p>
    </article>
  );
}
