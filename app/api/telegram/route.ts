import { env } from "@/lib/env";
import {
  loadThread,
  saveThread,
  saveCompose,
  loadCompose,
  clearCompose,
  type ComposeState,
} from "@/lib/redis";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  escapeHtml,
  downloadTelegramFile,
  type InlineKeyboard,
  type TelegramFile,
} from "@/lib/telegram";
import { sendReply, type OutgoingAttachment } from "@/lib/resend";
import { reSubject } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: { id: number };
  reply_to_message?: { message_id: number };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: { file_id: string; file_size?: number }[];
}

interface CallbackQuery {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

// Buttons under an active draft. Emoji supply the "color"; the clear-files row
// only appears when there's something to clear.
function composeKeyboard(state: ComposeState): InlineKeyboard {
  const keyboard: InlineKeyboard = [
    [
      { text: "✅ Отправить", callback_data: "send" },
      { text: "❌ Отменить", callback_data: "cancel" },
    ],
  ];
  if (state.files.length) {
    keyboard.push([{ text: "🗑 Очистить файлы", callback_data: "clearfiles" }]);
  }
  return keyboard;
}

export async function POST(req: Request): Promise<Response> {
  // 1. Verify the update really came from Telegram.
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !==
    env.telegramWebhookSecret()
  ) {
    return new Response("forbidden", { status: 403 });
  }

  const update = (await req.json()) as TelegramUpdate;

  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (err) {
    console.error("Telegram update handling failed:", err);
  }

  // Always 200 so Telegram doesn't retry.
  return Response.json({ ok: true });
}

// ── Button presses ───────────────────────────────────────────────────────────
async function handleCallback(cb: CallbackQuery): Promise<void> {
  const chatId = cb.message?.chat.id;
  if (chatId === undefined || String(chatId) !== env.telegramChatId()) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const data = cb.data ?? "";

  if (data.startsWith("reply:")) {
    const sourceMessageId = Number(data.slice("reply:".length));
    await startCompose(chatId, sourceMessageId, cb.id);
    return;
  }
  if (data === "send") {
    await finalizeCompose(chatId, cb.id);
    return;
  }
  if (data === "cancel") {
    await cancelCompose(chatId, cb.id);
    return;
  }
  if (data === "clearfiles") {
    await clearComposeFiles(chatId, cb.id);
    return;
  }

  await answerCallbackQuery(cb.id);
}

async function startCompose(
  chatId: number,
  sourceMessageId: number,
  cbId: string,
): Promise<void> {
  const thread = await loadThread(sourceMessageId);
  if (!thread) {
    await answerCallbackQuery(cbId, "Тред устарел — ответить нельзя");
    return;
  }

  const state: ComposeState = {
    thread,
    texts: [],
    files: [],
    statusMessageId: null,
  };
  state.statusMessageId = await sendMessage(
    chatId,
    composeStatus(state),
    composeKeyboard(state),
  );
  await saveCompose(chatId, state);
  await answerCallbackQuery(cbId, "Режим ответа включён");
}

async function clearComposeFiles(chatId: number, cbId: string): Promise<void> {
  const state = await loadCompose(chatId);
  if (!state) {
    await answerCallbackQuery(cbId, "Нет активного черновика");
    return;
  }
  state.files = [];
  await saveCompose(chatId, state);
  await answerCallbackQuery(cbId, "Файлы убраны");
  if (state.statusMessageId !== null) {
    await editMessageText(
      chatId,
      state.statusMessageId,
      composeStatus(state),
      composeKeyboard(state),
    );
  }
}

async function finalizeCompose(chatId: number, cbId: string): Promise<void> {
  const state = await loadCompose(chatId);
  if (!state) {
    await answerCallbackQuery(cbId, "Нет активного черновика");
    return;
  }
  await answerCallbackQuery(cbId, "Отправляю…");

  // Re-download the attached files now (we only stored their Telegram ids).
  const attachments: OutgoingAttachment[] = [];
  for (const f of state.files) {
    const file = await downloadTelegramFile(f.fileId, f.filename);
    if (file) {
      attachments.push({
        filename: file.filename,
        content: file.content,
        content_type: file.contentType,
      });
    }
  }

  const text = state.texts.join("\n\n").trim() || "(вложение)";

  try {
    await sendReply({
      from: state.thread.receivedFor || env.mailFrom(),
      to: state.thread.replyTo,
      subject: reSubject(state.thread.subject),
      text,
      inReplyTo: state.thread.messageId,
      references: state.thread.references,
      attachments: attachments.length ? attachments : undefined,
    });

    await clearCompose(chatId);
    const note = attachments.length ? ` (+${attachments.length} вложение)` : "";
    if (state.statusMessageId !== null) {
      await editMessageText(
        chatId,
        state.statusMessageId,
        `✅ Ответ отправлен на <b>${escapeHtml(state.thread.replyTo)}</b>${note}.`,
      );
    }
  } catch (err) {
    console.error("Failed to send reply:", err);
    // Keep the draft so the user can press Send again.
    if (state.statusMessageId !== null) {
      await editMessageText(
        chatId,
        state.statusMessageId,
        composeStatus(state) +
          "\n\n❌ Не удалось отправить. Нажми «Отправить» ещё раз.",
        composeKeyboard(state),
      );
    }
  }
}

async function cancelCompose(chatId: number, cbId: string): Promise<void> {
  const state = await loadCompose(chatId);
  await clearCompose(chatId);
  await answerCallbackQuery(cbId, "Отменено");
  if (state?.statusMessageId != null) {
    await editMessageText(chatId, state.statusMessageId, "✖️ Черновик отменён.");
  }
}

// ── Incoming messages ────────────────────────────────────────────────────────
async function handleMessage(message: TelegramMessage): Promise<void> {
  // Single-user lock.
  if (String(message.chat.id) !== env.telegramChatId()) return;

  const text = (message.text ?? message.caption ?? "").trim();
  const hasFile = Boolean(message.document || message.photo?.length);

  // Commands.
  if (text === "/start" || text === "/help") {
    await sendMessage(message.chat.id, HELP_TEXT);
    return;
  }
  if (text === "/cancel") {
    await cancelCompose(message.chat.id, "");
    return;
  }

  // If a draft is open, everything the user sends feeds into it.
  const state = await loadCompose(message.chat.id);
  if (state) {
    await appendToCompose(message.chat.id, state, message, text, hasFile);
    return;
  }

  if (!text && !hasFile) return;

  // Fallback quick path: a native Telegram Reply sends a one-shot answer.
  await handleNativeReply(message, text, hasFile);
}

async function appendToCompose(
  chatId: number,
  state: ComposeState,
  message: TelegramMessage,
  text: string,
  hasFile: boolean,
): Promise<void> {
  if (text) state.texts.push(text);

  if (message.document) {
    state.files.push({
      fileId: message.document.file_id,
      filename: message.document.file_name ?? "attachment",
    });
  } else if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    state.files.push({ fileId: largest.file_id, filename: "photo.jpg" });
  } else if (hasFile) {
    // Unsupported media type (sticker, voice, etc.) — ignore quietly.
  }

  await saveCompose(chatId, state);
  if (state.statusMessageId !== null) {
    await editMessageText(
      chatId,
      state.statusMessageId,
      composeStatus(state),
      composeKeyboard(state),
    );
  }
}

async function handleNativeReply(
  message: TelegramMessage,
  text: string,
  hasFile: boolean,
): Promise<void> {
  const repliedTo = message.reply_to_message?.message_id;
  if (!repliedTo) {
    await sendMessage(
      message.chat.id,
      "ℹ️ Нажми <b>✍️ Ответить</b> под письмом (или сделай Reply на него), " +
        "затем пришли текст и файлы.",
    );
    return;
  }

  const thread = await loadThread(repliedTo);
  if (!thread) {
    await sendMessage(
      message.chat.id,
      "⚠️ Не нашёл это письмо в памяти (тред мог устареть).",
    );
    return;
  }

  const attachments: OutgoingAttachment[] = [];
  const file = await collectAttachment(message);
  if (hasFile && !file) {
    await sendMessage(
      message.chat.id,
      "⚠️ Не удалось скачать вложение (лимит 20 МБ). Отправляю без него.",
    );
  }
  if (file) {
    attachments.push({
      filename: file.filename,
      content: file.content,
      content_type: file.contentType,
    });
  }

  try {
    await sendReply({
      from: thread.receivedFor || env.mailFrom(),
      to: thread.replyTo,
      subject: reSubject(thread.subject),
      text: text || "(вложение)",
      inReplyTo: thread.messageId,
      references: thread.references,
      attachments: attachments.length ? attachments : undefined,
    });
    const confirmId = await sendMessage(
      message.chat.id,
      `✅ Ответ отправлен на <b>${escapeHtml(thread.replyTo)}</b>.`,
    );
    if (confirmId !== null) await saveThread(confirmId, thread);
  } catch (err) {
    console.error("Failed to send reply:", err);
    await sendMessage(message.chat.id, "❌ Не удалось отправить ответ.");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function collectAttachment(
  message: TelegramMessage,
): Promise<TelegramFile | null> {
  if (message.document) {
    return downloadTelegramFile(
      message.document.file_id,
      message.document.file_name ?? "attachment",
    );
  }
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return downloadTelegramFile(largest.file_id, "photo.jpg");
  }
  return null;
}

function composeStatus(state: ComposeState): string {
  const joined = state.texts.join(" ").trim();
  const preview = joined
    ? escapeHtml(joined.length > 200 ? joined.slice(0, 200) + "…" : joined)
    : "<i>—</i>";

  let files = `<b>Вложений:</b> ${state.files.length}`;
  if (state.files.length) {
    files += "\n" + state.files.map((f) => `  • ${escapeHtml(f.filename)}`).join("\n");
  }

  return (
    `✍️ <b>Ответ для</b> ${escapeHtml(state.thread.replyTo)}\n` +
    `<b>Тема:</b> ${escapeHtml(reSubject(state.thread.subject))}\n` +
    `<b>Текст:</b> ${preview}\n` +
    `${files}\n\n` +
    `Пришли ещё текст и/или файлы, затем нажми <b>Отправить</b>.`
  );
}

const HELP_TEXT =
  "👋 Я пересылаю входящие письма сюда.\n\n" +
  "Чтобы ответить: нажми <b>✍️ Ответить</b> под письмом, затем пришли текст " +
  "и/или приложи файлы и фото — они копятся в черновике. Когда готов — нажми " +
  "<b>✅ Отправить</b> (или <b>❌ Отменить</b>).\n\n" +
  "Быстрый вариант: можно просто сделать <b>Reply</b> на письмо одним " +
  "сообщением. <code>/cancel</code> — сбросить черновик.";
