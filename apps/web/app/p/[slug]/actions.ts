"use server";
/**
 * "Follow" on a project's public page (docs/THESIS_REVIEW.md package 1.6): the Server Action behind the form, so it
 * posts and answers without JavaScript too. It reads the four fields and calls the api's signed-out
 * `publicPage.follow` with no bearer; the api decides everything (the page, the switch, the address, the limits, the
 * suppression list) and answers the same way whether the address was new or already following.
 *
 * Next.js checks a Server Action's Origin against the Host before it runs (its CSRF guard). What the visitor reads back
 * is one of the shared sentences (`FOLLOW_ERRORS`, lib/public-follow.ts), never the api's own message.
 */
import type { ProjectFollowState } from "@foundmill/dugout";
import { followErrorState, followFormProblem, readFollowForm } from "@/lib/public-follow";
import { createApiClient, SERVER_LIMITS } from "@/lib/trpc";

export async function followProject(_previous: ProjectFollowState, form: FormData): Promise<ProjectFollowState> {
  const input = readFollowForm(form);
  const problem = followFormProblem(input);
  if (problem) return problem;
  const api = createApiClient({ getToken: () => null, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }), limits: SERVER_LIMITS });
  try {
    await api.publicPage.follow.mutate({ slug: input.slug, email: input.email, consent: input.consent, website: input.website || null });
    return { status: "done" };
  } catch (err) {
    return followErrorState(err, input.email);
  }
}
