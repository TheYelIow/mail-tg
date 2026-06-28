import { Webhook } from "svix";
import { env } from "@/lib/env";
import { getReceivedEmail, listReceivedAttachments } from "@/lib/resend";
import { saveThread } from "@/lib/redis";
import {
  sendMessage,
  sendFileByUrl,
  editMessageReplyMarkup,
  escapeHtml,
} from "@/lib/telegram";
import {
  parseAddress,
  displayName,
  getHeader,
  buildReferences,
  bodyText,
} from "@/lib/mail";

export const runtime = "nodejs";
// Inbound mail can be large; don't statically optimize.
export const dynamic = "force-dynamic";

interface InboundEvent {
  type: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    received_for?: string[];
    message_id: string;
    subject?: string;
    attachments?: { id: string; filename: string; content_type: string }[];
  };
}

export async function POST(req: Request): Promise<Response> {
  const payload = await req.text();

  // 1. Verify the webhook signature (svix headers).
  let event: InboundEvent;
  try {
    const wh = new Webhook(env.resendWebhookSecret());
    event = wh.verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as InboundEvent;
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return new Response("invalid signature", { status: 401 });
  }

  if (event.type !== "email.received") {
    // Ack other event types so Resend doesn't retry.
    return Response.json({ ok: true, ignored: event.type });
  }

  try {
    const meta = event.data;

    // 2. Pull the full body (webhook is metadata-only).
    const email = await getReceivedEmail(meta.email_id);

    const fromAddr = parseAddress(meta.from);
    const fromName = displayName(meta.from);
    const receivedFor = meta.received_for?.[0] ?? meta.to?.[0] ?? "";
    const messageId = getHeader(email, "message-id") ?? meta.message_id;
    const subject = meta.subject ?? email.subject ?? "(без темы)";
    const body = bodyText(email);

    const attachments = meta.attachments ?? [];
    const attachmentLine = attachments.length
      ? `\n📎 ${attachments.length} вложение(й): ${attachments
          .map((a) => escapeHtml(a.filename))
          .join(", ")}`
      : "";

    // 3. Post to Telegram.
    const header =
      `📩 <b>${escapeHtml(fromName)}</b> &lt;${escapeHtml(fromAddr)}&gt;\n` +
      `<b>Тема:</b> ${escapeHtml(subject)}\n` +
      `<i>кому: ${escapeHtml(receivedFor)}</i>${attachmentLine}\n` +
      `${"—".repeat(20)}\n`;

    const telegramMessageId = await sendMessage(
      env.telegramChatId(),
      header + escapeHtml(body),
    );

    // 4. Remember the thread, then add a "Reply" button that points back to it.
    if (telegramMessageId !== null) {
      await saveThread(telegramMessageId, {
        emailId: meta.email_id,
        messageId,
        references: buildReferences(email, messageId),
        replyTo: fromAddr,
        receivedFor,
        subject,
      });
      await editMessageReplyMarkup(env.telegramChatId(), telegramMessageId, [
        [{ text: "✍️ Ответить", callback_data: `reply:${telegramMessageId}` }],
      ]);
    }

    // 5. Forward attachments as real files/photos (download URLs valid ~1h).
    if (attachments.length) {
      try {
        const files = await listReceivedAttachments(meta.email_id);
        for (const file of files) {
          await sendFileByUrl(
            env.telegramChatId(),
            file.download_url,
            file.filename,
            file.content_type,
            file.filename,
          );
        }
      } catch (err) {
        console.error("Failed to forward attachments:", err);
        await sendMessage(
          env.telegramChatId(),
          "⚠️ Вложения есть, но переслать их не удалось — открой письмо в Resend.",
        );
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Failed to process inbound email:", err);
    // Return 500 so Resend retries; the email is also safe in the dashboard.
    return new Response("processing error", { status: 500 });
  }
}
