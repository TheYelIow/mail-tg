export default function Home() {
  return (
    <main>
      <h1>📬 tg-mail-bot</h1>
      <p>
        Inbound email arrives via Resend, gets forwarded to Telegram, and
        replies are sent back through the mail thread.
      </p>
      <ul>
        <li>
          <code>POST /api/inbound</code> — Resend <code>email.received</code>{" "}
          webhook
        </li>
        <li>
          <code>POST /api/telegram</code> — Telegram bot webhook
        </li>
        <li>
          <code>GET /api/health</code> — liveness check
        </li>
      </ul>
    </main>
  );
}
