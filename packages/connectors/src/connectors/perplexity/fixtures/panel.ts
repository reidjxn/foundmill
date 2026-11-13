/** Recorded-shape fixtures for the Perplexity panel: an Agent API response (`POST /v1/agent`) with search results and a message. */

export const PERPLEXITY_FIXTURE_CITATIONS = [
  { url: "https://www.example-reviews.test/best-invoicing-apps", title: "Best invoicing apps for freelancers" },
  { url: "https://northwindskincare.example/", title: "Northwind Skincare" },
] as const;

export const PERPLEXITY_RESPONSE_FIXTURE = {
  id: "resp_fixture_001",
  object: "response",
  created_at: 1_794_000_000,
  status: "completed",
  model: "perplexity/sonar",
  output: [
    {
      type: "search_results",
      queries: ["best invoicing app for freelancers"],
      results: [
        { id: 1, url: PERPLEXITY_FIXTURE_CITATIONS[0].url, title: PERPLEXITY_FIXTURE_CITATIONS[0].title, snippet: "A comparison of invoicing tools.", date: "2026-09-01", source: "web" },
        { id: 2, url: PERPLEXITY_FIXTURE_CITATIONS[1].url, title: PERPLEXITY_FIXTURE_CITATIONS[1].title, snippet: "Simple billing for freelancers.", source: "web" },
        // A repeat, an untitled result, and a non-web link: the repeat and the non-web link are dropped.
        { id: 3, url: PERPLEXITY_FIXTURE_CITATIONS[1].url, title: "Northwind again", snippet: "", source: "web" },
        { id: 4, url: "https://untitled.example/page", snippet: "", source: "web" },
        { id: 5, url: "javascript:alert(1)", title: "bad", snippet: "", source: "web" },
      ],
    },
    {
      id: "msg_fixture_001",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Popular picks are Northwind Invoices for simple billing [2] and a few larger suites for teams [1].", annotations: [] }],
    },
  ],
  usage: { input_tokens: 1200, output_tokens: 90, total_tokens: 1290 },
};

export const PERPLEXITY_MODELS_FIXTURE = { object: "list", data: [{ id: "perplexity/sonar", object: "model", created: 0, owned_by: "perplexity" }] };

export const PERPLEXITY_UNAUTHORIZED_FIXTURE = { error: { message: "Invalid API key provided. Ensure your API key is correct and active.", type: "invalid_api_key", code: 401 } };
