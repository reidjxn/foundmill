/**
 * The basis on which an agent may email someone (WP-08 T10; audit a5 §3.8, GTM-14, GTM-33): decided in policy at send
 * time (`packages/policy/src/policies/15-mail-basis.cedar`), found by the gateway (`apps/gateway/src/recipient-basis.ts`).
 * - `consent`: the person agreed to hear from the project (a confirmed, unwithdrawn follow or consent);
 * - `relationship`: they wrote to the project or paid it within `PROJECT_MAIL_RELATIONSHIP_MS`;
 * - `recorded`: the founder added them with a lawful basis written down (D4: the founder approves each first message);
 * - `none`: nothing of the above. An agent never emails them, in any mode.
 */
export const RECIPIENT_BASES = ["consent", "relationship", "recorded", "none"] as const;
export type RecipientBasis = (typeof RECIPIENT_BASES)[number];

/** The tools that send email to a person, as `connector:tool`. The basis is found and checked for these only. */
export const MAIL_SEND_TOOLS = ["platform_mail:send_mail", "sendgrid:send_mail", "sendgrid:schedule_campaign", "resend:send_mail", "gmail:send_message"] as const;

export const isMailSendTool = (connector: string, tool: string): boolean => (MAIL_SEND_TOOLS as readonly string[]).includes(`${connector}:${tool}`);
