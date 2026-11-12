/** Recorded-shape fixtures: an Interactions API answer with Google Search grounding (shape per the 2026-11-12 docs). */
export const PANEL_CITATIONS = [
  { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf0123", title: "northwindskincare.com" },
  { url: "https://www.example.com/best-serums-for-sensitive-skin", title: "Best serums for sensitive skin" },
] as const;

export const mockPanelAnswer = (question: string): string => `This is a mock answer, not from Gemini. For "${question}", a few well-reviewed options come up; compare ingredients and reviews before choosing.`;

const ANSWER = "Northwind Skincare is often recommended for sensitive skin. Reviewers praise its fragrance-free serum.";

/** What `POST /v1beta/interactions` returns for a grounded question. */
export const INTERACTION_RESPONSE = {
  id: "interaction_fixture_1",
  model: "gemini-3.8-flash",
  steps: [
    { type: "thought", summary: [{ type: "text", text: "Searching." }], signature: "sig" },
    { type: "google_search_call", id: "call_1", arguments: { queries: ["best serum for sensitive skin"] } },
    { type: "google_search_result", call_id: "call_1", result: [{ type: "search_suggestions", html: "<div>suggestions</div>" }] },
    {
      type: "model_output",
      content: [
        {
          type: "text",
          text: ANSWER,
          annotations: [
            { type: "url_citation", url: PANEL_CITATIONS[0].url, title: PANEL_CITATIONS[0].title, start_index: 0, end_index: 18 },
            { type: "url_citation", url: PANEL_CITATIONS[1].url, title: PANEL_CITATIONS[1].title, start_index: 40, end_index: 90 },
            { type: "url_citation", url: PANEL_CITATIONS[1].url, title: "duplicate", start_index: 40, end_index: 90 },
            { type: "url_citation", url: "javascript:alert(1)", title: "bad scheme", start_index: 0, end_index: 1 },
            { type: "url_citation", url: "https://example.org/untitled", start_index: 0, end_index: 1 },
          ],
        },
      ],
    },
  ],
} as const;
export const INTERACTION_ANSWER = ANSWER;

export const MODEL_RESPONSE = { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash" };
export const KEY_REJECTED = { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } };
