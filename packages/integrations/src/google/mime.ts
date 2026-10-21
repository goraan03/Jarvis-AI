import type { gmail_v1 } from "googleapis";

/** Builds a base64url-encoded RFC 2822 message for Gmail's `raw` field —
 * verified against Gmail API sending documentation. */
export function buildRawMessage(params: { to: string; subject: string; body: string }): string {
  const lines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    params.body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function decodePart(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function findTextPlainPart(payload: gmail_v1.Schema$MessagePart): string | null {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodePart(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const found = findTextPlainPart(part);
    if (found) return found;
  }
  return null;
}

/** Walks a (possibly multipart) Gmail message payload looking for the
 * plain-text part specifically (never returning an HTML part's body by
 * accident); falls back to the top-level body for simple, non-multipart
 * messages rather than throwing on unusual MIME shapes. */
export function extractPlainTextBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plainText = findTextPlainPart(payload);
  if (plainText) return plainText;
  if (payload.body?.data) {
    return decodePart(payload.body.data);
  }
  return "";
}

export function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}
