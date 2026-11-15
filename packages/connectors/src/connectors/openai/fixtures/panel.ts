/** Recorded-shape fixtures for the OpenAI panel: a Responses API answer with a web_search_call and url_citation annotations. */

export const OPENAI_FIXTURE_CITATIONS = [
  { url: "https://www.example-reviews.test/best-invoicing-apps", title: "Best invoicing apps for freelancers" },
  { url: "https://northwindskincare.example/", title: "Northwind Skincare" },
] as const;

export const OPENAI_RESPONSE_FIXTURE = {
  id: "resp_fixture_001",
  object: "response",
  status: "completed",
  model: "gpt-6-astra-2026-10-01",
  output: [
    { id: "ws_fixture_001", type: "web_search_call", status: "completed", action: { type: "search", query: "best invoicing app for freelancers" } },
    {
      id: "msg_fixture_001",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Popular picks are Northwind Invoices for simple billing and a few larger suites for teams.",
          annotations: [
            { type: "url_citation", start_index: 14, end_index: 32, url: OPENAI_FIXTURE_CITATIONS[1].url, title: OPENAI_FIXTURE_CITATIONS[1].title },
            { type: "url_citation", start_index: 60, end_index: 90, url: OPENAI_FIXTURE_CITATIONS[0].url, title: OPENAI_FIXTURE_CITATIONS[0].title },
            // A repeat of the first, a non-web link and a file citation: all dropped.
            { type: "url_citation", start_index: 91, end_index: 92, url: OPENAI_FIXTURE_CITATIONS[1].url, title: OPENAI_FIXTURE_CITATIONS[1].title },
            { type: "url_citation", start_index: 0, end_index: 1, url: "javascript:alert(1)", title: "bad" },
            { type: "file_citation", file_id: "file_1", filename: "a.pdf", index: 0 },
          ],
        },
      ],
    },
  ],
};

export const OPENAI_MODEL_FIXTURE = { id: "gpt-6-astra", object: "model", created: 1_790_000_000, owned_by: "system" };

export const OPENAI_UNAUTHORIZED_FIXTURE = { error: { message: "Incorrect API key provided: sk-proj-****abcd. You can find your API key at https://platform.openai.com/account/api-keys.", type: "invalid_request_error", code: "invalid_api_key" } };
