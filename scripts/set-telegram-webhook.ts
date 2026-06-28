/**
 * Registers (or re-registers) the Telegram webhook so updates are delivered to
 * this app. Run after deploying:
 *
 *   PUBLIC_URL=https://your-app.vercel.app \
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *   npm run set-webhook
 *
 * Locals are read from your shell / .env (Next doesn't auto-load .env for
 * standalone scripts, so export them or use a tool like dotenv-cli).
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const publicUrl = process.env.PUBLIC_URL;

if (!token || !secret || !publicUrl) {
  console.error(
    "Missing env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL",
  );
  process.exit(1);
}

const webhookUrl = `${publicUrl.replace(/\/$/, "")}/api/telegram`;

async function main() {
  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const meData = await meRes.json();
  if (!meRes.ok || !meData.ok) {
    console.error("getMe failed ->", JSON.stringify(meData, null, 2));
    process.exit(1);
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
    },
  );
  const data = await res.json();
  console.log("setWebhook ->", JSON.stringify(data, null, 2));

  if (!res.ok || !data.ok) {
    process.exit(1);
  }

  const infoRes = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
  );
  const info = await infoRes.json();
  if (!infoRes.ok || !info.ok) {
    console.error("getWebhookInfo failed ->", JSON.stringify(info, null, 2));
    process.exit(1);
  }
  console.log("getWebhookInfo ->", JSON.stringify(info, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
