import type { ReceivedEmail } from "./resend";

/** Extract the bare email address from a `"Name" <addr@x>` string. */
export function parseAddress(input: string): string {
  const match = input.match(/<([^>]+)>/);
  return (match ? match[1] : input).trim();
}

/** Display name part of a `"Name" <addr@x>` string, or the address itself. */
export function displayName(input: string): string {
  const match = input.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : parseAddress(input);
}

/** Prefix a subject with "Re:" unless it already has one. */
export function reSubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re:";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Pull a header value out of the two shapes Resend may return headers in. */
export function getHeader(email: ReceivedEmail, name: string): string | null {
  const headers = email.headers;
  if (!headers) return null;
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    const found = headers.find((h) => h.name.toLowerCase() === lower);
    return found?.value ?? null;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Build the References chain for a reply: previous References + the
 * Message-ID we're replying to.
 */
export function buildReferences(
  email: ReceivedEmail,
  messageId: string,
): string[] {
  const prior = getHeader(email, "references");
  const refs = prior ? prior.split(/\s+/).filter(Boolean) : [];
  if (messageId && !refs.includes(messageId)) refs.push(messageId);
  return refs;
}

/**
 * Crude but dependency-free HTML→text: strip tags, decode the few common
 * entities, collapse blank lines. Good enough to read an email in Telegram.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The best readable body we can get from a received email. */
export function bodyText(email: ReceivedEmail): string {
  if (email.text && email.text.trim()) return email.text.trim();
  if (email.html && email.html.trim()) return htmlToText(email.html);
  return "(пустое тело письма)";
}
