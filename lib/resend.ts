import { Resend } from "resend";
import { env } from "./env";

let client: Resend | null = null;

export function resend(): Resend {
  if (!client) {
    client = new Resend(env.resendApiKey());
  }
  return client;
}

// Shape of a received email body as returned by the Receiving API.
export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  // RFC headers may carry the Message-ID etc.
  headers?: Record<string, string> | { name: string; value: string }[];
}

/**
 * Fetch the full body of a received email. The webhook only carries metadata,
 * so we pull html/text here.
 *
 * Uses the SDK method when available, otherwise falls back to the REST endpoint
 * so this keeps working across resend-node versions.
 */
export async function getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const sdk = resend() as unknown as {
    emails?: { receiving?: { get?: (id: string) => Promise<{ data: ReceivedEmail }> } };
  };

  const sdkGet = sdk.emails?.receiving?.get;
  if (typeof sdkGet === "function") {
    const { data } = await sdkGet.call(sdk.emails!.receiving, emailId);
    return data;
  }

  // REST fallback.
  const res = await fetch(`https://api.resend.com/emails/received/${emailId}`, {
    headers: { Authorization: `Bearer ${env.resendApiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`Resend receiving.get failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ReceivedEmail;
}

// Metadata of an attachment on a received email, plus a short-lived download URL.
export interface ReceivedAttachment {
  id: string;
  filename: string;
  content_type: string;
  size?: number;
  /** Pre-signed URL, valid for ~1 hour. */
  download_url: string;
}

/**
 * List attachments of a received email. The webhook only carries metadata, so
 * this returns the `download_url` we forward to Telegram.
 */
export async function listReceivedAttachments(
  emailId: string,
): Promise<ReceivedAttachment[]> {
  const sdk = resend() as unknown as {
    emails?: {
      receiving?: {
        attachments?: {
          list?: (args: { emailId: string }) => Promise<{ data: ReceivedAttachment[] }>;
        };
      };
    };
  };

  const list = sdk.emails?.receiving?.attachments?.list;
  if (typeof list === "function") {
    const { data } = await list.call(sdk.emails!.receiving!.attachments, { emailId });
    return data ?? [];
  }

  // REST fallback.
  const res = await fetch(
    `https://api.resend.com/emails/received/${emailId}/attachments`,
    { headers: { Authorization: `Bearer ${env.resendApiKey()}` } },
  );
  if (!res.ok) {
    throw new Error(`Resend attachments.list failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: ReceivedAttachment[] } | ReceivedAttachment[];
  return Array.isArray(json) ? json : (json.data ?? []);
}

// A file to attach to an outgoing reply.
export interface OutgoingAttachment {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  content_type?: string;
}

export interface ReplyInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Message-ID of the email we're replying to. */
  inReplyTo: string;
  /** Full References chain (space-joined Message-IDs). */
  references: string[];
  attachments?: OutgoingAttachment[];
}

export async function sendReply(input: ReplyInput): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (input.inReplyTo) headers["In-Reply-To"] = input.inReplyTo;
  if (input.references.length) headers["References"] = input.references.join(" ");

  const { data, error } = await resend().emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    headers,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.content_type,
    })),
  });

  if (error) {
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
  return data?.id ?? null;
}
