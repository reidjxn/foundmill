import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { DRIVE_DOCS, DRIVE_EXPORTS, DRIVE_FILES } from "./fixtures/files";
import { docText, GOOGLE_DRIVE_KEY, GOOGLE_DRIVE_RATE_LIMITS, GOOGLE_DRIVE_SCOPES, googleDriveTools, mapFile, type GDoc, type GFile } from "./tools";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

/** One Drive per business (the fixtures are copied for each): documents one business's agents write, no other business sees. */
export function createGoogleDriveMock() {
  const world = perBusiness(() => ({
    files: new Map<string, GFile>(DRIVE_FILES.map((f) => [f.id, structuredClone(f)])),
    docs: new Map<string, GDoc>(Object.entries(DRIVE_DOCS).map(([k, v]) => [k, structuredClone(v)])),
    exportsText: new Map<string, string>(Object.entries(DRIVE_EXPORTS)),
  }));

  return buildMockConnector({
    key: GOOGLE_DRIVE_KEY,
    displayName: "Google Drive & Docs",
    phase: 1,
    auth: { kind: "oauth", scopes: GOOGLE_DRIVE_SCOPES },
    tools: googleDriveTools,
    rateLimits: GOOGLE_DRIVE_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      search_files: async ({ q, mimeType, pageSize }, ctx) => {
        const { files, docs, exportsText } = world(ctx.businessId);
        const needle = q.toLowerCase();
        const items = [...files.values()].filter((f) => (!mimeType || f.mimeType === mimeType) && (f.name.toLowerCase().includes(needle) || (exportsText.get(f.id) ?? docText(docs.get(f.id)?.body?.content)).toLowerCase().includes(needle))).slice(0, pageSize).map(mapFile);
        return { items, nextPageToken: null };
      },
      get_file: async ({ fileId }, ctx) => {
        const f = world(ctx.businessId).files.get(fileId);
        if (!f) throw notFound(`file ${fileId}`);
        return mapFile(f);
      },
      export_text: async ({ fileId, maxChars }, ctx) => {
        const { files, docs, exportsText } = world(ctx.businessId);
        const f = files.get(fileId);
        if (!f) throw notFound(`file ${fileId}`);
        const text = exportsText.get(fileId) ?? (docs.has(fileId) ? docText(docs.get(fileId)!.body?.content) : "");
        if (!text && f.mimeType.startsWith("image/")) throw Object.assign(new Error(`file ${fileId} (${f.mimeType}) cannot be exported as text`), { status: 400 });
        return { fileId, mimeType: "text/plain", text: text.slice(0, maxChars), truncated: text.length > maxChars };
      },
      read_doc: async ({ documentId }, ctx) => {
        const d = world(ctx.businessId).docs.get(documentId);
        if (!d) throw notFound(`document ${documentId}`);
        return { documentId, title: d.title, text: docText(d.body?.content), revisionId: d.revisionId ?? null };
      },
      create_doc: async ({ title, text }, ctx) => {
        const { files, docs } = world(ctx.businessId);
        const documentId = `1m${stableHash(["doc", title], 22)}`;
        docs.set(documentId, { documentId, title, revisionId: "r1", body: { content: text ? [{ endIndex: text.length + 1, paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } }] : [] } });
        files.set(documentId, { id: documentId, name: title, mimeType: "application/vnd.google-apps.document", modifiedTime: MOCK_NOW.toISOString(), webViewLink: `https://docs.google.com/document/d/${documentId}`, owners: [{ emailAddress: "agent@northwindskincare.com" }] });
        return { documentId, url: `https://docs.google.com/document/d/${documentId}` };
      },
      append_to_doc: async ({ documentId, text }, ctx) => {
        const d = world(ctx.businessId).docs.get(documentId);
        if (!d) throw notFound(`document ${documentId}`);
        const content = d.body?.content ?? [];
        content.push({ endIndex: (content.at(-1)?.endIndex ?? 1) + text.length + 1, paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } });
        d.body = { content };
        return { documentId, appendedChars: text.length };
      },
      share_file: async ({ fileId, email, role }, ctx) => {
        if (!world(ctx.businessId).files.has(fileId)) throw notFound(`file ${fileId}`);
        return { permissionId: stableHash(["perm", fileId, email], 20), fileId, email, role };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(GOOGLE_DRIVE_KEY, businessId, { accountLabel: "reid@northwindskincare.com (mock)", scopes: GOOGLE_DRIVE_SCOPES }),
    healthcheck: async (integration) => mockHealth(GOOGLE_DRIVE_KEY, { files: world(integration.businessId).files.size }),
  });
}

export const googleDriveMock = createGoogleDriveMock();
