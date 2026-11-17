import { landingSwitches } from "@/components/landing/flags";
import { llmsTxt } from "@/lib/seo";

/** /llms.txt (WP-03 T6): a short plain-text description for AI readers. Static; read once at build, like the home page. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt({ signupOpen: landingSwitches(process.env).signupOpen }), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
