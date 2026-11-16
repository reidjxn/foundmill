// Run: node --test scripts/supabase-config.test.mjs
// supabase/config.toml is what `supabase config push` sends to the production Supabase project (docs/DEPLOY.md §4).
// Its sign-in redirect list holds production's callbacks and nothing else: Supabase sends the sign-in code to any
// address the list matches, so a preview pattern on a shared host or localhost there would hand codes to whoever can
// serve that address. Previews and localhost belong in a development Supabase project.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_REDIRECTS = ["https://foundmill.com/auth/callback**", "https://www.foundmill.com/auth/callback**", "foundmill://auth/callback"];

/** The strings of `additional_redirect_urls = [ ... ]` in the `[auth]` section (comments dropped). */
function redirectUrls(text) {
  const auth = text.split(/^\[auth\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const list = /additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/.exec(auth.replace(/#.*$/gm, ""));
  assert.ok(list, "supabase/config.toml declares [auth] additional_redirect_urls");
  return [...list[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe("supabase/config.toml", () => {
  const text = readFileSync(join(root, "supabase/config.toml"), "utf8");

  it("redirects sign-in only to production's callbacks and the mobile app", () => {
    assert.deepEqual(redirectUrls(text), PRODUCTION_REDIRECTS);
  });

  it("keeps the site address on production", () => {
    assert.match(text, /^site_url = "https:\/\/foundmill\.com"$/m);
  });

  // WP-03 T4: a new address gets Supabase's "Confirm signup" email, not the magic link, so both templates carry the
  // link and the six-digit code the sign-in page asks for. A new check (the file did not look at templates before).
  for (const [section, file, subject] of [
    ["magic_link", "magic_link.html", "Sign in to Foundmill"],
    ["confirmation", "confirm_signup.html", "Your Foundmill sign-in code"],
  ]) {
    it(`declares the ${section} template, whose file carries the link and the code`, () => {
      const body = text.split(new RegExp(`^\\[auth\\.email\\.template\\.${section}\\]\\s*$`, "m"))[1]?.split(/^\[/m)[0];
      assert.ok(body, `supabase/config.toml declares [auth.email.template.${section}]`);
      assert.match(body, new RegExp(`^subject = "${subject}"$`, "m"));
      assert.match(body, new RegExp(`^content_path = "\\./supabase/templates/${file.replace(".", "\\.")}"$`, "m"));
      const path = join(root, "supabase/templates", file);
      assert.ok(existsSync(path), `supabase/templates/${file} exists`);
      const html = readFileSync(path, "utf8");
      assert.ok(html.includes("{{ .Token }}"), `${file} carries {{ .Token }}`);
      assert.ok(html.includes("{{ .ConfirmationURL }}"), `${file} carries {{ .ConfirmationURL }}`);
    });
  }
});
