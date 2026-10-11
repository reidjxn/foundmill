/**
 * Sign out from inside the app (the sidebar foot and the command palette): a full-page POST to `/auth/signout`, which
 * ends the Supabase session, clears the dev and last-business cookies and lands on /login. A POST form rather than a
 * link, so a router prefetch can never sign the founder out and another site cannot do it with an image tag.
 */
export const SIGN_OUT_PATH = "/auth/signout";

export function signOut(doc: Document = document): void {
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = SIGN_OUT_PATH;
  form.hidden = true;
  doc.body.appendChild(form);
  form.submit();
}
