/**
 * Write to your followers (WP-08 T3; audit a5 GTM-01): one update from the founders to the people who confirmed they
 * want to hear from the project, sent from its Foundmill address by the founder's own press. An agent may draft one
 * (`draft_follower_update`); nothing an agent does sends it.
 *
 * Every word the screen, the confirm dialog, Today and the email's footer use is here. US English, plain. The footer
 * line about AI (founder D2, Nov 16, 2026) is added when the team drafted the update, with the first name of the
 * member who checked it and pressed Send.
 */
export const PROJECT_UPDATE_SUBJECT_MAX = 200;
export const PROJECT_UPDATE_BODY_MAX = 10_000;

export const PROJECT_UPDATE_STATUSES = ["draft", "sending", "sent", "canceled"] as const;
export type ProjectUpdateStatus = (typeof PROJECT_UPDATE_STATUSES)[number];

/** One call sends at most this many (the project's daily cap by default); "Send the rest" sends the next. */
export const PROJECT_UPDATE_BATCH_MAX = 50;

/** Why a follower got nothing from this update (kept on the delivery row; never an address). */
export const PROJECT_UPDATE_SKIPS = ["suppressed", "no_basis", "no_address", "refused"] as const;
export type ProjectUpdateSkip = (typeof PROJECT_UPDATE_SKIPS)[number];

/** The subject and the body, as a founder or an agent wrote them: the first problem in plain words, or null. */
export function updateProblems(subject: string, body: string): string | null {
  const s = subject.trim();
  const b = body.trim();
  if (!s) return "Give the update a subject.";
  if (/[\r\n]/.test(subject)) return "Keep the subject to one line.";
  if (s.length > PROJECT_UPDATE_SUBJECT_MAX) return `Keep the subject under ${PROJECT_UPDATE_SUBJECT_MAX} characters.`;
  if (!b) return "Write something for your followers to read.";
  if (b.length > PROJECT_UPDATE_BODY_MAX) return `Keep the update under ${PROJECT_UPDATE_BODY_MAX.toLocaleString("en-US")} characters.`;
  return null;
}

/** The footer line about AI (founder D2): only when the team drafted the update. */
export function aiFooterLine(input: { draftedByAgent: boolean; checkerFirstName: string | null }): string | null {
  if (!input.draftedByAgent) return null;
  return `Written with help from AI and checked by ${input.checkerFirstName?.trim() || "the founders"}.`;
}

/** The plain text a follower gets: the body, then the AI line when there is one (the gateway adds the legal footer). */
export function updateText(body: string, aiLine: string | null): string {
  const text = body.trim();
  return aiLine ? `${text}\n\n${aiLine}` : text;
}

const people = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;

export const PROJECT_UPDATE_WORDS = {
  button: (followers: number) => `Write to your followers (${followers.toLocaleString("en-US")})`,
  panelTitle: "Write to your followers",
  subjectLabel: "Subject",
  bodyLabel: "What you want to tell them",
  save: "Save draft",
  preview: "This is exactly what they get",
  send: "Send",
  sendRest: "Send the rest",
  cancel: "Delete draft",
  confirm: (followers: number, project: string) => `This goes to ${people(followers)} who asked to hear from ${project}. It cannot be unsent.`,
  confirmButton: "Send it",
  confirmBack: "Not yet",
  draftedByTeam: "The team drafted this. Check it, change anything, then send.",
  sent: (n: number) => `Sent to ${people(n)}.`,
  sentWithRest: (n: number, rest: number) => `Sent to ${people(n)}. ${rest.toLocaleString("en-US")} more go tomorrow: press Send the rest.`,
  simulated: "Simulated: email is not switched on here, so nothing was sent.",
  noFollowers: "Nobody follows the project yet. Share your page, and the people who follow it show up here.",
  postalAddressTitle: "Add a postal address first",
  postalAddressMissing: "US law asks every email that tells people about a business to include a postal address, so readers know who is writing to them. A PO box or a mailbox service works. You add it once in Settings › Integrations, and it goes at the bottom of each update.",
  todayDraft: "An update to your followers is ready to check",
  todayInvite: (followers: number, project: string) => `${people(followers)} ${followers === 1 ? "follows" : "follow"} ${project}. Write to them.`,
} as const;

/** Why a send did not go out, in plain words. */
export const PROJECT_UPDATE_REFUSALS: Record<string, string> = {
  off: "Email from the project is not switched on yet, so nothing was sent.",
  unconfigured: "Email from the project is not set up yet, so nothing was sent.",
  simulated: "Email is not switched on here, so nothing was sent.",
  not_found: "That update is no longer here.",
  not_draft: "That update was already sent or deleted.",
  changed: "The update changed since you checked it. Check it again, then send.",
  no_postal_address: "Add your postal address first: US law requires it in this kind of email. Nothing was sent.",
  paused: "Email from the project's address is paused, so nothing was sent.",
  own_sender: "The project sends email from your own connected account, so send it from there. Nothing was sent.",
  daily_cap: "The project has sent all the email it can today. Press Send the rest tomorrow.",
  ceiling: "Email from every project together has reached today's limit. Press Send the rest tomorrow.",
  store: "Email is not available for a moment. Try again in a few minutes.",
  content: "The update could not be sent as written. Keep it to plain text.",
  vendor: "The email service did not take some messages. Press Send the rest to try again.",
};
