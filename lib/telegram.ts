import { env } from "./env";

const TELEGRAM_MAX = 4096;

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${env.telegramBotToken()}/${method}`;
}

/** Escape text for Telegram HTML parse mode. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface SendMessageResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

// Telegram has no custom button colors; emoji in the label give the "color".
export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][];

/**
 * Send an HTML message to a chat. Returns the Telegram message_id of the
 * (last) message sent, or null. Long messages are split to stay under the
 * 4096-char limit; an optional inline keyboard is attached to the last chunk.
 */
export async function sendMessage(
  chatId: string | number,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<number | null> {
  const chunks = splitForTelegram(html);
  let lastId: number | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (isLast && keyboard) body.reply_markup = { inline_keyboard: keyboard };

    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as SendMessageResult;
    if (!data.ok) {
      throw new Error(`Telegram sendMessage failed: ${data.description}`);
    }
    lastId = data.result?.message_id ?? lastId;
  }

  return lastId;
}

/** Replace the text (and optionally buttons) of an existing message. */
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

  const res = await fetch(apiUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as SendMessageResult;
  if (!data.ok) console.warn(`Telegram editMessageText failed: ${data.description}`);
}

/** Attach (or replace) the inline keyboard of an existing message. */
export async function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  keyboard: InlineKeyboard,
): Promise<void> {
  const res = await fetch(apiUrl("editMessageReplyMarkup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
  const data = (await res.json()) as SendMessageResult;
  if (!data.ok)
    console.warn(`Telegram editMessageReplyMarkup failed: ${data.description}`);
}

/** Acknowledge a button press (stops the client's loading spinner). */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await fetch(apiUrl("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

/**
 * Forward a file to Telegram by URL (Telegram fetches it itself). Images go as
 * photos; everything else as documents. Falls back to a document, then to a
 * plain text note, so a single oversized/odd file never breaks the flow.
 *
 * Telegram URL limits: photo ≤ 5 MB, document ≤ 20 MB.
 */
export async function sendFileByUrl(
  chatId: string | number,
  url: string,
  filename: string,
  contentType: string,
  caption?: string,
): Promise<void> {
  const isImage = contentType.startsWith("image/") && contentType !== "image/svg+xml";

  if (isImage && (await trySend("sendPhoto", chatId, { photo: url, caption }))) {
    return;
  }
  if (
    await trySend("sendDocument", chatId, {
      document: url,
      caption: caption ?? filename,
    })
  ) {
    return;
  }

  await sendMessage(
    chatId,
    `📎 Вложение <b>${escapeHtml(filename)}</b> не удалось переслать ` +
      `(${escapeHtml(contentType)}). Открой его в Resend.`,
  );
}

async function trySend(
  method: "sendPhoto" | "sendDocument",
  chatId: string | number,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...payload }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) console.warn(`Telegram ${method} failed: ${data.description}`);
    return data.ok;
  } catch (err) {
    console.warn(`Telegram ${method} threw:`, err);
    return false;
  }
}

export interface TelegramFile {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  contentType: string;
}

/**
 * Download a file the user sent the bot (document or photo), so it can be
 * attached to an outgoing email. Telegram's getFile/download works up to 20 MB.
 */
export async function downloadTelegramFile(
  fileId: string,
  fallbackName: string,
): Promise<TelegramFile | null> {
  const token = env.telegramBotToken();

  const info = await fetch(apiUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  }).then((r) => r.json() as Promise<{ ok: boolean; result?: { file_path: string } }>);

  if (!info.ok || !info.result?.file_path) {
    console.warn("Telegram getFile failed for", fileId);
    return null;
  }

  const filePath = info.result.file_path;
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
  );
  if (!fileRes.ok) {
    console.warn("Telegram file download failed:", fileRes.status);
    return null;
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const filename = filePath.split("/").pop() || fallbackName;
  return {
    filename,
    content: buffer.toString("base64"),
    contentType:
      fileRes.headers.get("content-type") || "application/octet-stream",
  };
}

// Split on newlines where possible, hard-splitting only when a single line is
// longer than the limit.
function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX) return [text];

  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > TELEGRAM_MAX) {
      if (current) chunks.push(current);
      if (line.length > TELEGRAM_MAX) {
        for (let i = 0; i < line.length; i += TELEGRAM_MAX) {
          chunks.push(line.slice(i, i + TELEGRAM_MAX));
        }
        current = "";
      } else {
        current = line;
      }
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
