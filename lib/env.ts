function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  resendApiKey: () => required("RESEND_API_KEY"),
  resendWebhookSecret: () => required("RESEND_WEBHOOK_SECRET"),
  mailFrom: () => required("MAIL_FROM"),

  telegramBotToken: () => required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: () => required("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: () => required("TELEGRAM_WEBHOOK_SECRET"),

  upstashUrl: () => required("UPSTASH_REDIS_REST_URL"),
  upstashToken: () => required("UPSTASH_REDIS_REST_TOKEN"),
};
