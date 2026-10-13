/**
 * Sign out from inside the app (the sidebar foot, the command palette and the sign-out button of the pages outside a
 * business): a full-page POST to `/auth/signout`, which ends this browser's Supabase session (not the founder's other
 * devices), clears the dev and last-business cookies and lands on /login. A POST form rather than a link, so a router
 * prefetch can never sign the founder out and another site cannot do it with a link, an image tag or a redirect (the
 * route answers POST only). The other tabs of this browser are told first, so they close their stream socket and go to
 * sign-in instead of staying on a business they can no longer reach (audit RES-08).
 */
import { announceSignedOut } from "./session-end";

export const SIGN_OUT_PATH = "/auth/signout";

export function signOut(doc: Document = document): void {
  announceSignedOut();
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = SIGN_OUT_PATH;
  form.hidden = true;
  doc.body.appendChild(form);
  form.submit();
}
