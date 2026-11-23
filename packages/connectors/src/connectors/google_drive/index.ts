/** Live Google Drive/Docs connector over the REST APIs with per-business OAuth tokens (auto-refresh). */
import { uuid } from "@foundmill/shared";
import type { Connector, ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { googleAccessToken, googleHeaders, googleOAuthConnect } from "../_shared/google-auth";
import { googleDriveMock } from "./mock";
import { docEndIndex, DOCS_BASE_URL, docText, DRIVE_BASE_URL, DRIVE_FIELDS, GOOGLE_DRIVE_KEY, GOOGLE_DRIVE_RATE_LIMITS, GOOGLE_DRIVE_READ_SCOPE, GOOGLE_DRIVE_SCOPES, driveSearchScope, googleDriveTools, mapFile, toDriveQuery, type GDoc, type GFile } from "./tools";

export function createGoogleDriveConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const deps = { connectorKey: GOOGLE_DRIVE_KEY, secrets, fetch, now };
  const clients = async (ctx: ToolContext): Promise<{ drive: HttpClient; docs: HttpClient }> => {
    const { accessToken } = await googleAccessToken(ctx, deps);
    const headers = googleHeaders(accessToken);
    return { drive: createHttp({ connectorKey: GOOGLE_DRIVE_KEY, baseUrl: DRIVE_BASE_URL, fetch, headers }), docs: createHttp({ connectorKey: GOOGLE_DRIVE_KEY, baseUrl: DOCS_BASE_URL, fetch, headers }) };
  };

  return buildLiveConnector(
    {
      key: GOOGLE_DRIVE_KEY,
      displayName: "Google Drive & Docs",
      phase: 1,
      auth: { kind: "oauth", scopes: GOOGLE_DRIVE_SCOPES, authorizationCode: true },
      tools: googleDriveTools,
      rateLimits: GOOGLE_DRIVE_RATE_LIMITS,
      now,
      handlers: {
        // Under drive.file alone Google lists only the files this app can open, so the search is honest by construction.
        search_files: async ({ q, mimeType, pageSize, pageToken }, ctx) => {
          const { drive } = await clients(ctx);
          const res = await drive.json<{ files?: GFile[]; nextPageToken?: string }>("GET", "/files", { query: { q: toDriveQuery(q, mimeType), pageSize, pageToken, fields: `nextPageToken,files(${DRIVE_FIELDS})` } });
          return { items: (res.files ?? []).map(mapFile), nextPageToken: res.nextPageToken ?? null, searched: driveSearchScope(ctx.integration.scopes) };
        },
        get_file: async ({ fileId }, ctx) => mapFile(await (await clients(ctx)).drive.json<GFile>("GET", `/files/${fileId}`, { query: { fields: DRIVE_FIELDS } })),
        export_text: async ({ fileId, maxChars }, ctx) => {
          const { drive } = await clients(ctx);
          const meta = await drive.json<GFile>("GET", `/files/${fileId}`, { query: { fields: "id,mimeType" } });
          const text = meta.mimeType.startsWith("application/vnd.google-apps.")
            ? await drive.text("GET", `/files/${fileId}/export`, { query: { mimeType: meta.mimeType.endsWith("spreadsheet") ? "text/csv" : "text/plain" } })
            : await drive.text("GET", `/files/${fileId}`, { query: { alt: "media" } });
          return { fileId, mimeType: meta.mimeType.endsWith("spreadsheet") ? "text/csv" : "text/plain", text: text.slice(0, maxChars), truncated: text.length > maxChars };
        },
        read_doc: async ({ documentId }, ctx) => {
          const doc = await (await clients(ctx)).docs.json<GDoc>("GET", `/documents/${documentId}`);
          return { documentId: doc.documentId, title: doc.title, text: docText(doc.body?.content), revisionId: doc.revisionId ?? null };
        },
        create_doc: async ({ title, text }, ctx) => {
          const { docs } = await clients(ctx);
          const doc = await docs.json<GDoc>("POST", "/documents", { body: { title } });
          if (text) await docs.json("POST", `/documents/${doc.documentId}:batchUpdate`, { body: { requests: [{ insertText: { location: { index: 1 }, text } }] } });
          return { documentId: doc.documentId, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
        },
        append_to_doc: async ({ documentId, text }, ctx) => {
          const { docs } = await clients(ctx);
          const doc = await docs.json<GDoc>("GET", `/documents/${documentId}`, { query: { fields: "documentId,body(content(endIndex))" } });
          await docs.json("POST", `/documents/${documentId}:batchUpdate`, { body: { requests: [{ insertText: { location: { index: docEndIndex(doc) }, text: `\n${text}` } }] } });
          return { documentId, appendedChars: text.length };
        },
        share_file: async ({ fileId, email, role, sendNotification, message }, ctx) => {
          const { drive } = await clients(ctx);
          const perm = await drive.json<{ id: string }>("POST", `/files/${fileId}/permissions`, { query: { sendNotificationEmail: sendNotification, emailMessage: message }, body: { type: "user", role, emailAddress: email } });
          return { permissionId: perm.id, fileId, email, role };
        },
      },
      connect: (businessId, input) => googleOAuthConnect(input, deps, { businessId, scopes: (input as { readDrive?: unknown } | null)?.readDrive === true ? [...GOOGLE_DRIVE_SCOPES, GOOGLE_DRIVE_READ_SCOPE] : GOOGLE_DRIVE_SCOPES, label: "Google Drive", newId: uuid, exactScopes: true }),
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        if (!secrets.googleClientId || !secrets.googleClientSecret) return healthResult("disconnected", startedAt, { now, message: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured" });
        return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
      },
    },
    googleDriveMock,
  );
}

export { googleDriveMock, createGoogleDriveMock } from "./mock";
export { googleDriveTools, GOOGLE_DRIVE_KEY } from "./tools";
