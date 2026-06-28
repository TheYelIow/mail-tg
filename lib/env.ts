function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

// Accept the first env var that is set, so we work with both Upstash's own
// names and the KV_* names Vercel's Marketplace integration injects.
function requiredOneOf(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable, set one of: ${names.join(", ")}`);
}

export const env = {
  resendApiKey: () => required("RESEND_API_KEY"),
  resendWebhookSecret: () => required("RESEND_WEBHOOK_SECRET"),
  mailFrom: () => required("MAIL_FROM"),

  telegramBotToken: () => required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: () => required("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: () => required("TELEGRAM_WEBHOOK_SECRET"),

  upstashUrl: () =>
    requiredOneOf("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"),
  upstashToken: () =>
    requiredOneOf("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"),
};
