/**
 * The Privacy Policy at /privacy (founder, 2026-11-13). Written for people in the United States and the European Union
 * (the GDPR, and the US state privacy laws, California's first). The founder's lawyer reviews it right after launch.
 *
 * Keep it true: when the product starts collecting something new, sends data to a new provider, sets a new cookie or
 * changes how long it keeps something, change this text and PRIVACY_UPDATED in the same change. The cookie list is
 * checked against the code by `legal-content.test.ts`.
 */
import { APP_NAME } from "@foundmill/config";
import type { LegalDocument } from "@foundmill/dugout";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LEGAL_ROUTES, PRIVACY_UPDATED, entityLine } from "./facts";

const mail = { text: LEGAL_CONTACT_EMAIL, href: `mailto:${LEGAL_CONTACT_EMAIL}` };
const terms = { text: "Terms of Service", href: LEGAL_ROUTES.terms };
const N = APP_NAME;

/** The cookies the site sets, by name (`legal-content.test.ts` checks them against the code). Each keeps a sign-in or a choice you made. */
export const PRIVACY_COOKIES = [
  { term: "sb-…-auth-token", detail: "Keeps you signed in. Set when you sign in, removed when you sign out." },
  { term: "sb-…-code-verifier", detail: "Protects a sign-in in progress (for example with Google). Lasts a few minutes." },
  { term: "fm_idea", detail: "Keeps the card you made on the home page before signing up, so you can keep it when you sign in. 7 days." },
  { term: "fm_via", detail: `Remembers the project's page or the person's profile on ${N} that brought you here, if one did, until you sign up. 30 days.` },
  { term: "fm_last_business", detail: "Opens the project you used last. Up to one year." },
  { term: "fm_date_format", detail: "The date format you chose. Up to one year." },
  { term: "fm_text_size", detail: "The text size you chose. Up to one year." },
] as const;

export const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  updated: PRIVACY_UPDATED,
  summary: [
    "We collect what we need to run your account and your projects, and nothing for advertising.",
    "We do not sell your personal data or share it for advertising, and we do not use your content to train AI models.",
    "Your idea stays private until you choose to share it.",
    "Your data is stored in the European Union. Some of the providers that do the work are in the United States.",
    "No tracking cookies: only the ones that keep you signed in and remember your settings.",
    ["You can ask to see, correct, export or delete your data at any time: write to ", mail, "."],
  ],
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      blocks: [
        { kind: "p", text: `${N} is run by ${entityLine()}. ${LEGAL_ENTITY.name} is the controller of the personal data described here, which means we decide how and why it is used.` },
        { kind: "p", text: ["This policy covers foundmill.com, the apps and the emails we send. It explains what we collect, why, who we share it with, how long we keep it and the choices you have. Our ", terms, " explain the rules for using ", N, "."] },
        { kind: "p", text: ["Questions about privacy go to ", mail, "."] },
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect",
      blocks: [
        { kind: "p", text: "What you give us:" },
        {
          kind: "terms",
          items: [
            { term: "Account", detail: "Your email address, your name and how you sign in. With Google, we receive your name, email address and profile picture from Google." },
            { term: "Profile", detail: "What you choose to add: a headline, where you are based, what you are good at and what you want to learn. A public profile shows only what you publish." },
            { term: "A card before sign-up", detail: "If you try the idea box on the home page before signing up, the line you type (or the interest you pick) and the card drafted from it. It is kept for 7 days, or until you sign in and keep it." },
            { term: "Projects", detail: "Your ideas and everything your team makes and does: plans, messages, drafts, code, pages, files, contacts you add, and your decisions and approvals." },
            { term: "Voice", detail: "If you talk to your team, the recording is turned into text. We keep the text, not the recording." },
            { term: "Keys", detail: "Keys you enter to connect your own accounts with other services. They are encrypted and used only to do what you ask." },
            { term: "Payments", detail: "What you bought and when. Stripe handles your card; we never see the full card number." },
            { term: "Messages to us", detail: "What you write when you contact us." },
          ],
        },
        { kind: "p", text: "What we collect as you use it:" },
        {
          kind: "terms",
          items: [
            { term: "Use", detail: `Which days you visit, when you were last active and what you do in ${N}, so we can show "since you were last here", send the emails you asked for, and improve the product.` },
            { term: "Device and network", detail: "Your IP address, browser and device type, kept in server logs to keep the service running and secure and to limit abuse." },
            { term: "How you found us", detail: `If a project's page or a person's profile on ${N} brought you, which one, recorded once when you sign up. Whoever it belongs to may be told that someone signed up through it, never who.` },
            { term: "Bot check", detail: ["The idea box on the home page uses Cloudflare Turnstile to block automated abuse: it checks your browser, without a puzzle, before a card is drafted. Cloudflare's handling of that data is set out in its ", { text: "Turnstile Privacy Addendum", href: "https://www.cloudflare.com/turnstile-privacy-policy/" }, "."] },
          ],
        },
        { kind: "p", text: "We do not ask for sensitive data such as health, religion or sexual orientation, and you should not add it to a project unless your business needs it." },
      ],
    },
    {
      id: "how-we-use",
      heading: "How we use it, and our legal bases",
      blocks: [
        { kind: "p", text: "Under the GDPR we need a legal basis for each use. Ours are:" },
        {
          kind: "terms",
          items: [
            { term: "To run the service", detail: "Your account, your projects, your team's work, sign-in and the emails that are part of the service. Basis: our contract with you." },
            { term: "To keep it safe", detail: "Preventing fraud, abuse and attacks, and limiting how much one person or address can use. Basis: our legitimate interest in a secure service." },
            { term: "To improve it", detail: "Understanding which parts are used and what goes wrong, mostly from counts and logs. Basis: our legitimate interest in a better product." },
            { term: "To write to you", detail: "Product news and reminders you can turn off in Settings or from any such email. Basis: our legitimate interest, or your consent where the law requires it." },
            { term: "To meet the law", detail: "Bookkeeping, tax, and answering lawful requests from authorities. Basis: our legal obligations." },
          ],
        },
        { kind: "p", text: "We do not make decisions about you that have legal or similarly significant effects by automated means alone." },
      ],
    },
    {
      id: "ai",
      heading: "AI and your content",
      blocks: [
        { kind: "p", text: "Your team of agents runs on AI models from other companies. To do what you ask, we send them the parts of your project the work needs. Under the terms we use them on, Anthropic and OpenAI do not use what we send to train their models." },
        { kind: "p", text: "We do not use your content to train AI models, and we do not sell it." },
        { kind: "p", text: "If you connect your own AI provider with your own key, that work runs on your account with that provider, under your agreement with them." },
      ],
    },
    {
      id: "sharing",
      heading: "Who we share it with",
      blocks: [
        { kind: "p", text: "We share personal data only in these ways:" },
        {
          kind: "list",
          items: [
            "With the people in your project: cofounders and collaborators see the project's work, as their access allows.",
            "With anyone, when you publish: a public page or profile is public.",
            "With the services you connect, when you ask your team to use them.",
            "With the providers below, who process it for us under contract and only on our instructions.",
            "With authorities, when the law requires it, and to protect people's safety or our rights.",
            `With a company that takes over ${N}, under this policy, and we will tell you first.`,
          ],
        },
        { kind: "p", text: "The providers that process personal data for us:" },
        {
          kind: "terms",
          items: [
            { term: "Supabase", detail: "Sign-in and the database. Stockholm, Sweden." },
            { term: "Railway", detail: "The servers that run the service. Amsterdam, the Netherlands." },
            { term: "Vercel", detail: "The website. Frankfurt, Germany, served through a worldwide network." },
            { term: "Anthropic", detail: "The AI models your agents run on. United States." },
            { term: "Voyage AI", detail: "Search across your project's own material. United States." },
            { term: "OpenAI", detail: "Pictures, such as agents' portraits. United States." },
            { term: "ElevenLabs", detail: "Turning your voice into text. United States." },
            { term: "E2B", detail: "Secure sandboxes where agents run code. United States." },
            { term: "Twilio SendGrid", detail: `Emails from ${N} and from your project's address. United States.` },
            { term: "Resend", detail: "Sign-in emails. United States." },
            { term: "OneSignal", detail: "Notifications on your phone, if you allow them. United States." },
            { term: "Stripe", detail: "Payments. Ireland and the United States." },
            { term: "Google", detail: "Sign-in with Google, if you use it. United States." },
            { term: "GitHub", detail: "Your project's code, if you connect it. United States." },
            { term: "Cloudflare", detail: ["The check that the idea box is used by a person, not a bot (Turnstile). United States. See ", { text: "Cloudflare's Turnstile Privacy Addendum", href: "https://www.cloudflare.com/turnstile-privacy-policy/" }, "."] },
          ],
        },
        { kind: "p", text: `Emails from ${N} and from your project's ${N} address carry no open or click tracking.` },
      ],
    },
    {
      id: "transfers",
      heading: "Where your data is",
      blocks: [
        { kind: "p", text: "Your account and your projects are stored in the European Union. When a provider in the United States processes them, the transfer is protected by the EU-U.S. Data Privacy Framework where the provider is certified, or by the European Commission's Standard Contractual Clauses. You can ask us for a copy of the safeguards that apply." },
      ],
    },
    {
      id: "retention",
      heading: "How long we keep it",
      blocks: [
        {
          kind: "terms",
          items: [
            { term: "Account", detail: "While your account is open. When you ask us to delete it, we delete it within 30 days." },
            { term: "A card before sign-up", detail: "7 days, unless you keep it by signing in; 90 days if you join the waitlist with it." },
            { term: "Projects", detail: "Until you delete them. A deleted project is removed 7 days after you ask, so you can change your mind." },
            { term: "Backups", detail: "Deleted data leaves our backups as they expire, within 30 days." },
            { term: "Server logs", detail: "Up to 30 days." },
            { term: "Sign-in codes and links", detail: "They expire after 15 minutes and work once." },
            { term: "Payment records", detail: "7 years, as Swedish bookkeeping law requires." },
            { term: "Voice recordings", detail: "Not kept: only the text is kept, with your project." },
          ],
        },
        { kind: "p", text: "We may keep something longer when the law requires it or to settle a dispute, and only for that." },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies",
      blocks: [
        { kind: "p", text: `We use no advertising or tracking cookies and no third-party analytics. The cookies and browser storage we use keep you signed in, remember a choice you made or remember which page on ${N} brought you, which is why we do not ask for consent to them:` },
        { kind: "terms", items: PRIVACY_COOKIES },
        { kind: "p", text: "Your browser also keeps a few settings on your device that are never sent to us, such as whether you folded the sidebar or opened a section." },
        { kind: "p", text: "You can delete them in your browser's settings. Without the sign-in cookies you will not stay signed in." },
      ],
    },
    {
      id: "eu-rights",
      heading: "Your rights in the European Union and the UK",
      blocks: [
        { kind: "p", text: "Under the GDPR you have the right to:" },
        {
          kind: "list",
          items: [
            "see the personal data we hold about you and get a copy",
            "correct it if it is wrong",
            "have it deleted",
            "get it in a format you can take to another service",
            "object to our use of it based on our legitimate interests, and to direct marketing at any time",
            "restrict how we use it while a question is settled",
            "withdraw consent where we rely on it, without affecting what came before",
          ],
        },
        { kind: "p", text: "You can also complain to a data protection authority: in Sweden, the Swedish Authority for Privacy Protection (Integritetsskyddsmyndigheten, imy.se), or the authority where you live or work. We would like the chance to help first." },
      ],
    },
    {
      id: "us-rights",
      heading: "Your rights in the United States",
      blocks: [
        { kind: "p", text: "If you live in California or another US state with a privacy law, you have the right to:" },
        {
          kind: "list",
          items: [
            "know what personal information we collect, use and disclose, and get a copy",
            "correct it",
            "delete it",
            "opt out of the sale or sharing of your personal information for targeted advertising: we do not sell or share it, and have not in the last 12 months",
            "not be treated differently for using these rights",
          ],
        },
        { kind: "p", text: "The categories we collect are the ones listed above: identifiers (such as your name, email and IP address), commercial information (what you bought), internet activity (how you use the product), audio (voice you choose to send, turned into text), professional information you add to your profile, and the content of your projects. We use them only for the purposes in this policy and do not use sensitive personal information to infer things about you." },
        { kind: "p", text: "We treat a Global Privacy Control signal from your browser as a request to opt out, though there is nothing to opt out of. You may use an authorized agent; we will ask them to show that you gave them permission." },
      ],
    },
    {
      id: "use-your-rights",
      heading: "How to use your rights",
      blocks: [
        { kind: "p", text: ["Write to ", mail, " from the email address on your account. We may ask you to confirm it is you. We answer within one month under the GDPR and within 45 days under US state laws; when a request is complex we may take longer, and will tell you why. It is free."] },
        { kind: "p", text: "You can edit your profile and delete a project yourself in the product. Closing your account and exporting all your data is done by request for now." },
      ],
    },
    {
      id: "google",
      heading: "Signing in with Google",
      blocks: [
        { kind: "p", text: "If you sign in with Google, we receive your name, email address and profile picture, and nothing else from your Google account. We use them only to sign you in and to show your name and picture in the product. We do not use them for advertising, do not sell them and do not share them except with the providers that run sign-in for us." },
        { kind: "p", text: [`${N}'s use of information received from Google follows the `, { text: "Google API Services User Data Policy", href: "https://developers.google.com/terms/api-services-user-data-policy" }, ", including the Limited Use requirements."] },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        { kind: "p", text: "Data travels encrypted. Keys you connect are sealed in an encrypted vault and used only by the one service that calls other companies. Each project's data is separated in the database so that only its own people can reach it, and access on our side is limited to the people who need it to run the service. No system is perfectly secure: if a breach puts your data at risk, we will tell you and the authorities as the law requires." },
      ],
    },
    {
      id: "children",
      heading: "Children",
      blocks: [{ kind: "p", text: `${N} is for people 18 and older. We do not knowingly collect data from anyone younger, and we delete an account we learn belongs to someone under 18.` }],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      blocks: [{ kind: "p", text: "We will update this policy when what we do changes. For a change that matters to you, we will tell you by email or in the product before it takes effect. The date at the top shows when it last changed." }],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        { kind: "p", text: ["Write to ", mail, "."] },
        { kind: "p", text: entityLine() + "." },
      ],
    },
  ],
};
