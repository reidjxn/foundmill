/**
 * Starter files for a project's first site (WP-07 T3): one page and one stylesheet, system fonts only, readable at
 * 390 px, with the sign-up form block. Strings in code (the orchestrator image reads no starter files at run time).
 * The first session of a site task starts from these and replaces the words with the project's own.
 */
export type StarterKey = "static-site";

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your project</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
<h1>One line that says what this is</h1>
<p>A short paragraph: who it is for, what it does for them, and what happens next.</p>
<form method="post" action="/_fm/follow">
<label for="email">Get news when it is ready</label>
<input id="email" type="email" name="email" required placeholder="you@example.com">
<button type="submit">Sign up</button>
</form>
</main>
<footer><p>Made with care.</p></footer>
</body>
</html>
`;

const STYLES_CSS = `*{box-sizing:border-box}
body{margin:0;font:18px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}
main{max-width:40rem;margin:0 auto;padding:48px 20px}
h1{font-size:2rem;line-height:1.2;margin:0 0 16px}
form{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
label{flex-basis:100%;font-weight:600}
input{flex:1 1 14rem;font:inherit;padding:10px;border:1px solid #8c959f;border-radius:8px}
button{font:inherit;padding:10px 18px;border:0;border-radius:8px;background:#1f2328;color:#fff}
footer{max-width:40rem;margin:0 auto;padding:0 20px 32px;color:#57606a;font-size:14px}
`;

/** The starter's files, path and text. */
export function starterFiles(key: StarterKey = "static-site"): { path: string; content: string }[] {
  if (key !== "static-site") throw new Error(`unknown site starter ${key}`);
  return [
    { path: "index.html", content: INDEX_HTML },
    { path: "styles.css", content: STYLES_CSS },
  ];
}
