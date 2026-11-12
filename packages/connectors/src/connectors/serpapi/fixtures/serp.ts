/** Recorded-shape SerpApi answers (Nov 12, 2026 docs): a skincare query with an inline AI Overview, the same with only a page token, the follow-up, and the account. */
import type { SerpAccount, SerpAiOverview, SerpSearchResponse } from "../tools";

export const SKINCARE_QUERY = "best moisturizer for dry skin";

export const SKINCARE_ORGANIC = [
  { position: 1, title: "The 12 Best Moisturizers for Dry Skin, Tested", link: "https://www.example-derm.org/best-moisturizers-dry-skin", snippet: "Dermatologists pick ceramide and hyaluronic acid creams that hold water in the skin barrier." },
  { position: 2, title: "How to Choose a Moisturizer for Dry Skin", link: "https://www.skinbasics.example/moisturizer-guide", snippet: "Look for humectants, emollients and occlusives, and apply to damp skin." },
  { position: 3, title: "Dry Skin Care: Tips and Products", link: "https://clinic.example/health/dry-skin", snippet: "Thicker creams and ointments work better than lotions in winter." },
  { position: 4, title: "Northwind Barrier Cream", link: "https://northwindskincare.com/products/barrier-cream", snippet: null },
  { position: 5, title: "r/SkincareAddiction: Moisturizer for very dry skin?", link: "https://forum.example/r/skincare/dry-moisturizer", snippet: "Anyone tried a ceramide cream that does not sting?" },
] as const;

export const SKINCARE_AI_OVERVIEW: SerpAiOverview = {
  text_blocks: [
    { type: "paragraph", snippet: "For dry skin, choose a rich cream with ceramides, hyaluronic acid and glycerin.", reference_indexes: [0, 1] },
    { type: "heading", snippet: "What to look for" },
    {
      type: "list",
      list: [
        { title: "Humectants", snippet: "Glycerin and hyaluronic acid draw water into the skin." },
        { title: "Emollients", snippet: "Ceramides smooth and repair the barrier.", list: [{ snippet: "Fragrance-free formulas sting less." }] },
      ],
    },
    { type: "expandable", text_blocks: [{ type: "paragraph", snippet: "Apply within three minutes of washing." }] },
    { type: "top_stories", top_stories: [{ title: "Ignored story" }] },
  ],
  references: [
    { title: "The 12 Best Moisturizers for Dry Skin, Tested", link: "https://www.example-derm.org/best-moisturizers-dry-skin" },
    { title: "How to Choose a Moisturizer for Dry Skin", link: "https://www.skinbasics.example/moisturizer-guide" },
    { link: "https://clinic.example/health/dry-skin" },
  ],
};

export const SKINCARE_AI_OVERVIEW_TEXT = [
  "For dry skin, choose a rich cream with ceramides, hyaluronic acid and glycerin.",
  "What to look for",
  "- Humectants: Glycerin and hyaluronic acid draw water into the skin.",
  "- Emollients: Ceramides smooth and repair the barrier.",
  "  - Fragrance-free formulas sting less.",
  "Apply within three minutes of washing.",
].join("\n");

/** What the account endpoint answers, secrets included: the connector must never pass `api_key` or `account_email` on. */
export const ACCOUNT_KEY_ECHO = "serpapi-account-key-echo";
export const ACCOUNT: SerpAccount & Record<string, unknown> = {
  account_id: "6540f1a2b3c4d5e6f7a8b9c0",
  api_key: ACCOUNT_KEY_ECHO,
  account_email: "founder@example.com",
  account_status: "Active",
  plan_id: "free",
  plan_name: "Free Plan",
  plan_monthly_price: 0,
  searches_per_month: 250,
  plan_searches_left: 231,
  extra_credits: 0,
  total_searches_left: 231,
  this_month_usage: 19,
  this_hour_searches: 2,
  last_hour_searches: 5,
  account_rate_limit_per_hour: 50,
};

export const searchInline = (): SerpSearchResponse => ({
  search_metadata: { id: "66f0c0ffee0000000000abcd", status: "Success" },
  organic_results: SKINCARE_ORGANIC.map((r) => ({ ...r })),
  ai_overview: SKINCARE_AI_OVERVIEW,
});
export const searchWithToken = (): SerpSearchResponse => ({
  search_metadata: { id: "66f0c0ffee0000000000abcd" },
  organic_results: SKINCARE_ORGANIC.map((r) => ({ ...r })),
  ai_overview: { page_token: "PAGE_TOKEN_123", serpapi_link: "https://serpapi.com/search.json?engine=google_ai_overview&page_token=PAGE_TOKEN_123" },
});
export const followUp = (): SerpSearchResponse => ({ ai_overview: SKINCARE_AI_OVERVIEW });
