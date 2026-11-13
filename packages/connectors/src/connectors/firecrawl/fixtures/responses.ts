/** Canned Firecrawl answers, shaped as documented at https://docs.firecrawl.dev/api-reference/endpoint/scrape and .../credit-usage (read Nov 12, 2026). */
export const SCRAPE_OK = {
  success: true,
  data: {
    markdown: "# Northwind Skincare\n\nFragrance-free skincare for sensitive skin.\n",
    metadata: {
      title: "Northwind Skincare",
      description: "Fragrance-free skincare for sensitive skin.",
      language: "en",
      sourceURL: "https://northwindskincare.com/",
      url: "https://www.northwindskincare.com/",
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
    },
  },
};

export const SCRAPE_NO_CONTENT = { success: true, data: { metadata: { statusCode: 200 } } };

export const CREDIT_USAGE_OK = { success: true, data: { remainingCredits: 4210, planCredits: 5000, billingPeriodStart: "2026-11-01T00:00:00Z", billingPeriodEnd: "2026-12-01T00:00:00Z" } };

export const UNAUTHORIZED = { success: false, error: "Unauthorized: Invalid token" };
export const RATE_LIMITED = { success: false, error: "Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0." };
export const INSUFFICIENT_CREDITS = { success: false, error: "Insufficient credits to perform this request." };
