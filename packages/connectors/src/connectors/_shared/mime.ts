/** Minimal RFC 5322 / MIME builder for Gmail `messages.send` (raw, base64url). Text-first; optional HTML alternative. */
export interface MimeInput {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  date?: Date;
  messageId?: string;
}

const encodeHeader = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);

/** A header value that carries a line break would start a new header (a hidden Bcc, a forged From): never written. */
const headerValue = (name: string, value: string): string => {
  if (/[\r\n\0]/.test(value)) throw new Error(`Invalid ${name} header: it contains a line break`);
  return value;
};

export function buildMimeMessage(input: MimeInput): string {
  // Every header value is checked once, here, so no field (reply ids, addresses, ids) can smuggle another header in.
  const m: MimeInput = {
    ...input,
    from: headerValue("From", input.from),
    to: input.to.map((v) => headerValue("To", v)),
    ...(input.cc ? { cc: input.cc.map((v) => headerValue("Cc", v)) } : {}),
    ...(input.bcc ? { bcc: input.bcc.map((v) => headerValue("Bcc", v)) } : {}),
    ...(input.messageId ? { messageId: headerValue("Message-ID", input.messageId) } : {}),
    ...(input.inReplyTo ? { inReplyTo: headerValue("In-Reply-To", input.inReplyTo) } : {}),
    ...(input.references ? { references: input.references.map((v) => headerValue("References", v)) } : {}),
  };
  const lines: string[] = [];
  lines.push(`From: ${m.from}`);
  lines.push(`To: ${m.to.join(", ")}`);
  if (m.cc?.length) lines.push(`Cc: ${m.cc.join(", ")}`);
  if (m.bcc?.length) lines.push(`Bcc: ${m.bcc.join(", ")}`);
  lines.push(`Subject: ${encodeHeader(m.subject)}`);
  lines.push(`Date: ${(m.date ?? new Date()).toUTCString()}`);
  if (m.messageId) lines.push(`Message-ID: ${m.messageId}`);
  if (m.inReplyTo) lines.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references?.length) lines.push(`References: ${m.references.join(" ")}`);
  lines.push("MIME-Version: 1.0");
  if (m.html) {
    const boundary = `=_fm_${Buffer.from(m.subject).toString("hex").slice(0, 12)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", chunk(Buffer.from(m.text, "utf8").toString("base64")), `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", chunk(Buffer.from(m.html, "utf8").toString("base64")), `--${boundary}--`);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", chunk(Buffer.from(m.text, "utf8").toString("base64")));
  }
  return lines.join("\r\n");
}

const chunk = (b64: string): string => b64.replace(/(.{76})/g, "$1\r\n");

export const toBase64Url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
export const fromBase64Url = (s: string): string => Buffer.from(s, "base64url").toString("utf8");
