import { Redis } from "@upstash/redis";
import { env } from "./env";

let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    client = new Redis({
      url: env.upstashUrl(),
      token: env.upstashToken(),
    });
  }
  return client;
}

// What we need to remember so a Telegram reply can be turned into an email reply
// in the correct thread.
export interface ThreadContext {
  /** Resend id of the received email. */
  emailId: string;
  /** RFC Message-ID of the received email (used for In-Reply-To). */
  messageId: string;
  /** All Message-IDs seen in this thread so far (used for References). */
  references: string[];
  /** Address that originally sent us the mail — we reply to this. */
  replyTo: string;
  /** Address the mail was sent to — we reply from this when possible. */
  receivedFor: string;
  /** Original subject, so we can prefix "Re:". */
  subject: string;
}

// Map a Telegram message we posted to the email thread it represents.
const threadKey = (telegramMessageId: number) => `thread:${telegramMessageId}`;

// Threads expire after 60 days — Resend keeps received emails for 30 days anyway.
const TTL_SECONDS = 60 * 24 * 60 * 60;

export async function saveThread(
  telegramMessageId: number,
  ctx: ThreadContext,
): Promise<void> {
  await redis().set(threadKey(telegramMessageId), ctx, { ex: TTL_SECONDS });
}

export async function loadThread(
  telegramMessageId: number,
): Promise<ThreadContext | null> {
  return (await redis().get<ThreadContext>(threadKey(telegramMessageId))) ?? null;
}

// ── Compose draft state ──────────────────────────────────────────────────────
// While the user is building a reply (text + files) we keep one draft per chat.
// We store Telegram file_ids (not bytes) and re-download them on send, keeping
// Redis small.

export interface ComposeFile {
  fileId: string;
  filename: string;
}

export interface ComposeState {
  thread: ThreadContext;
  texts: string[];
  files: ComposeFile[];
  /** Message with the Send/Cancel buttons, edited as the draft changes. */
  statusMessageId: number | null;
}

const composeKey = (chatId: string | number) => `compose:${chatId}`;

// Abandoned drafts self-destruct after an hour.
const COMPOSE_TTL_SECONDS = 60 * 60;

export async function saveCompose(
  chatId: string | number,
  state: ComposeState,
): Promise<void> {
  await redis().set(composeKey(chatId), state, { ex: COMPOSE_TTL_SECONDS });
}

export async function loadCompose(
  chatId: string | number,
): Promise<ComposeState | null> {
  return (await redis().get<ComposeState>(composeKey(chatId))) ?? null;
}

export async function clearCompose(chatId: string | number): Promise<void> {
  await redis().del(composeKey(chatId));
}
