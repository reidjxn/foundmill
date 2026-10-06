/** Google Drive + Docs: find and read documents, create/append docs, share files. OAuth per business. */
import { z } from "zod";
import { defineTool } from "../../define";

export const GOOGLE_DRIVE_KEY = "google_drive";
export const DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
export const DOCS_BASE_URL = "https://docs.googleapis.com/v1";
export const GOOGLE_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.readonly"];

export const DriveFile = z.object({ id: z.string(), name: z.string(), mimeType: z.string(), modifiedTime: z.string(), webViewLink: z.string().nullable(), size: z.number().int().nullable(), owners: z.array(z.string()) });
export type DriveFileT = z.infer<typeof DriveFile>;
export const FileId = z.string().min(5).max(200);

export const googleDriveTools = [
  defineTool({
    name: "search_files",
    description: "Search Drive files by name/content (free text) or a Drive query (`name contains 'x' and mimeType = '...'`).",
    input: z.object({ q: z.string().min(1).max(300), mimeType: z.string().max(100).optional(), pageSize: z.number().int().min(1).max(100).default(20), pageToken: z.string().optional() }),
    output: z.object({ items: z.array(DriveFile), nextPageToken: z.string().nullable() }),
    hints: {},
    untrusted: "file",
    untrustedRef: (a) => `search:${a.q}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "get_file", description: "File metadata.", input: z.object({ fileId: FileId }), output: DriveFile, hints: {}, untrusted: "file", untrustedRef: (a) => `file:${a.fileId}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "export_text",
    description: "Plain-text export of a Google Doc/Sheet/Slides file (or the content of a text file).",
    input: z.object({ fileId: FileId, maxChars: z.number().int().min(100).max(500_000).default(100_000) }),
    output: z.object({ fileId: z.string(), mimeType: z.string(), text: z.string(), truncated: z.boolean() }),
    hints: {},
    untrusted: "document",
    untrustedRef: (a) => `export:${a.fileId}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "read_doc",
    description: "Read a Google Doc as plain text with its title and revision id.",
    input: z.object({ documentId: FileId }),
    output: z.object({ documentId: z.string(), title: z.string(), text: z.string(), revisionId: z.string().nullable() }),
    hints: {},
    untrusted: "document",
    untrustedRef: (a) => `doc:${a.documentId}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "create_doc", description: "Create a Google Doc with a title and body text.", input: z.object({ title: z.string().min(1).max(200), text: z.string().max(200_000).default("") }), output: z.object({ documentId: z.string(), url: z.string() }), hints: {} }),
  defineTool({ name: "append_to_doc", description: "Append text to the end of a Google Doc.", input: z.object({ documentId: FileId, text: z.string().min(1).max(200_000) }), output: z.object({ documentId: z.string(), appendedChars: z.number().int() }), hints: {} }),
  defineTool({
    name: "share_file",
    description: "Share a file with an email address (reader/commenter/writer). Sends Google's notification email to the recipient.",
    input: z.object({ fileId: FileId, email: z.email(), role: z.enum(["reader", "commenter", "writer"]).default("reader"), sendNotification: z.boolean().default(true), message: z.string().max(1000).optional() }),
    output: z.object({ permissionId: z.string(), fileId: z.string(), email: z.string(), role: z.string() }),
    hints: { contactsThirdParty: true },
  }),
] as const;

export const GOOGLE_DRIVE_RATE_LIMITS = { perMinute: 200, perDay: 20_000 };

/* ---- Vendor shapes (subset) ---- */
export interface GFile { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string; size?: string; owners?: { emailAddress?: string; displayName?: string }[] }
export interface GDoc { documentId: string; title: string; revisionId?: string; body?: { content?: GStructuralElement[] } }
export interface GStructuralElement { endIndex?: number; paragraph?: { elements?: { textRun?: { content?: string } }[] }; table?: { tableRows?: { tableCells?: { content?: GStructuralElement[] }[] }[] } }

export const mapFile = (f: GFile): DriveFileT => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime ?? new Date(0).toISOString(), webViewLink: f.webViewLink ?? null, size: f.size ? Number(f.size) : null, owners: (f.owners ?? []).map((o) => o.emailAddress ?? o.displayName ?? "").filter(Boolean) });

export function docText(elements: GStructuralElement[] | undefined): string {
  let out = "";
  for (const el of elements ?? []) {
    if (el.paragraph) out += (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
    if (el.table) for (const row of el.table.tableRows ?? []) out += `${(row.tableCells ?? []).map((c) => docText(c.content).trim()).join(" | ")}\n`;
  }
  return out;
}

export const docEndIndex = (doc: GDoc): number => Math.max(1, (doc.body?.content ?? []).reduce((m, el) => Math.max(m, el.endIndex ?? 0), 1) - 1);

/** Free text → Drive `q` (full-text + name). Pass-through when the caller already wrote a Drive query. */
export const toDriveQuery = (q: string, mimeType?: string): string => {
  const base = /\b(contains|=|!=|and|or|in)\b/.test(q) ? q : `(name contains '${q.replace(/'/g, "\\'")}' or fullText contains '${q.replace(/'/g, "\\'")}')`;
  return `${base} and trashed = false${mimeType ? ` and mimeType = '${mimeType}'` : ""}`;
};

export const DRIVE_FIELDS = "id,name,mimeType,modifiedTime,webViewLink,size,owners(emailAddress,displayName)";
