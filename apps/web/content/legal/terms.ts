/**
 * The Terms of Service at /terms (founder, 2026-11-13). Written for people in the United States and the European Union,
 * under Swedish law; the founder's lawyer reviews it right after launch. Plain words, US English and US dates, the
 * product's own vocabulary (CLAUDE.md). When the product changes what it does with money, email, agents or accounts,
 * change this text and TERMS_UPDATED in the same change.
 */
import { APP_NAME } from "@foundmill/config";
import type { LegalBlock, LegalDocument, LegalSection } from "@foundmill/dugout";
import { COPYRIGHT_AGENT, LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LEGAL_ROUTES, TERMS_UPDATED, entityLine, type CopyrightAgent } from "./facts";

const mail = { text: LEGAL_CONTACT_EMAIL, href: `mailto:${LEGAL_CONTACT_EMAIL}` };
const privacy = { text: "Privacy Policy", href: LEGAL_ROUTES.privacy };
const N = APP_NAME;

/** The US Copyright Office's directory of designated agents. */
export const DMCA_DIRECTORY_URL = "https://www.copyright.gov/dmca-directory/";

/** Where notices go: the registered agent's details once registered, else the intake email and the company's address. */
function copyrightAgentBlock(agent: CopyrightAgent): LegalBlock {
  const email = { text: agent.email, href: `mailto:${agent.email}` };
  const address = agent.postalAddress ?? LEGAL_ENTITY.postalAddress;
  if (!agent.registered) {
    return {
      kind: "terms",
      items: [
        { term: "Email", detail: email },
        ...(address ? [{ term: "Post", detail: `${LEGAL_ENTITY.name}, Attn: Copyright Agent, ${address}` }] : []),
      ],
    };
  }
  return {
    kind: "terms",
    items: [
      { term: "Designated agent", detail: agent.name },
      ...(address ? [{ term: "Address", detail: address }] : []),
      { term: "Email", detail: email },
      ...(agent.phone ? [{ term: "Phone", detail: agent.phone }] : []),
      {
        term: "Registration",
        detail: [
          "Listed in the US Copyright Office's ",
          { text: "DMCA Designated Agent Directory", href: DMCA_DIRECTORY_URL },
          agent.registrationNumber ? `, registration number ${agent.registrationNumber}` : "",
        ],
      },
    ],
  };
}

/**
 * Copyright complaints under the US DMCA (17 U.S.C. § 512; founder, 2026-11-13): the notice (§ 512(c)(3)), what we do,
 * the counter-notice (§ 512(g)), repeat infringers (§ 512(i)) and false notices (§ 512(f)). Kept close to the statute:
 * no promises beyond it. Not legal advice; the founder's lawyer reviews it with the rest.
 */
export function copyrightSection(agent: CopyrightAgent = COPYRIGHT_AGENT): LegalSection {
  return {
    id: "copyright",
    heading: "Copyright complaints",
    blocks: [
      { kind: "p", text: `If you believe that something on ${N} infringes a copyright you own, or one you are authorized to act for, you can ask us to remove it. This section follows the US Digital Millennium Copyright Act (17 U.S.C. § 512).` },
      { kind: "p", text: agent.registered ? "Send notices to our designated copyright agent:" : "Send notices to our copyright agent:" },
      copyrightAgentBlock(agent),
      { kind: "p", text: "Your notice must include all of the following:" },
      {
        kind: "list",
        items: [
          "your physical or electronic signature, as the copyright owner or as someone authorized to act for the owner",
          "a description of the copyrighted work you say is infringed or, if your notice covers several works on one site, a representative list of them",
          `a description of the material you say is infringing, with enough information for us to find it, such as the address of the page on ${N}`,
          "your contact information: your address, telephone number and email address",
          "a statement that you believe in good faith that the use of the material in the way you complain of is not authorized by the copyright owner, its agent or the law",
          "a statement that the information in your notice is accurate and, under penalty of perjury, that you are the copyright owner or authorized to act for the owner",
        ],
      },
      { kind: "p", text: "When we receive a notice that meets these requirements, we promptly remove the material or disable access to it, and we promptly take reasonable steps to tell the person who posted it." },
      { kind: "p", text: "If material you posted was removed or disabled because of a notice, and you believe that happened by mistake or because the material was misidentified, you can send a counter-notice to the same address. It must include all of the following:" },
      {
        kind: "list",
        items: [
          "your physical or electronic signature",
          "a description of the material that was removed or disabled, and where it appeared before it was removed or disabled",
          "a statement, under penalty of perjury, that you believe in good faith that the material was removed or disabled by mistake or because it was misidentified",
          "your name, address and telephone number",
          // plain-allow: the statute's own words (§ 512(g)(3)(D)); a counter-notice must state this consent as written.
          "a statement that you consent to the jurisdiction of the US federal district court for the judicial district where your address is or, if your address is outside the United States, for any judicial district in which we may be found, and that you will accept service of process from the person who sent the notice or from their agent",
        ],
      },
      { kind: "p", text: "When we receive a counter-notice that meets these requirements, we promptly send a copy to the person who sent the notice and tell them that we will restore the material, or stop disabling access to it, in 10 business days. We then do so no sooner than 10 and no later than 14 business days after we receive the counter-notice, unless our copyright agent first receives notice from that person that they have filed a court action seeking an order to stop you from infringing with that material on " + N + "." },
      { kind: "p", text: "In appropriate circumstances, we close the accounts of people who repeatedly infringe copyrights." },
      { kind: "p", text: "Do not send a false notice or counter-notice. Under 17 U.S.C. § 512(f), anyone who knowingly and materially misrepresents that material is infringing, or that it was removed or disabled by mistake or misidentification, can be liable for damages, including costs and attorneys' fees. If you are not sure, consider asking a lawyer before you send one." },
    ],
  };
}

export const TERMS: LegalDocument = {
  title: "Terms of Service",
  updated: TERMS_UPDATED,
  summary: [
    `You must be 18 or older to use ${N}.`,
    "What you make is yours. We use it only to run the service for you.",
    "Your team of AI agents works for you, and it can be wrong. Check its work before you rely on it.",
    "Agents never move money, sign anything, accept terms or file anything in your name. You do those yourself.",
    "You are responsible for what your project does in the world, including what it sends and sells.",
    "Swedish law applies, and if you are a consumer you keep the protections of the country you live in.",
  ],
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are and what these terms cover",
      blocks: [
        { kind: "p", text: `${N} is run by ${entityLine()} ("we", "us"). These terms are an agreement between you and us about your use of ${N}: the website at foundmill.com, the apps, the emails we send and everything your team of agents does inside ${N}.` },
        { kind: "p", text: ["By creating an account or using ", N, ", you agree to these terms. How we handle personal data is described in our ", privacy, ", which is part of these terms."] },
      ],
    },
    {
      id: "who-can-use",
      heading: `Who can use ${N}`,
      blocks: [
        { kind: "p", text: `You must be 18 or older and able to enter into a binding agreement. You confirm this when you sign up. ${N} is not for children, and we close accounts we learn belong to someone under 18.` },
        { kind: "p", text: `You may not use ${N} if you are barred from doing so under the laws that apply to you, including sanctions laws.` },
      ],
    },
    {
      id: "account",
      heading: "Your account",
      blocks: [
        { kind: "p", text: "You sign in with an email link or code, or with Google. Keep access to your email account and your Google account secure: anyone who can open them can sign in as you." },
        { kind: "list", items: ["One account is for one person. Do not share it.", "Give us an email address that is yours and that you read.", ["Tell us at ", mail, " if you think someone else has used your account."]] },
      ],
    },
    {
      id: "what-it-does",
      heading: `What ${N} does`,
      blocks: [
        { kind: "p", text: `${N} gives you a team of AI agents that help you shape an idea, build it and run it as a project or business. Agents research, write, plan, draft code and pages, and, where you allow it, take actions such as publishing a page or sending an email.` },
        { kind: "p", text: "AI makes mistakes. An agent can be wrong, out of date or incomplete, and two runs of the same request can give different answers. Numbers marked Forecast or Estimate are not facts. Read and check what your team produces before you rely on it or put it in front of anyone else." },
        { kind: "p", text: `Nothing in ${N} is legal, financial, tax, medical or investment advice. For decisions that need a professional, ask one.` },
        { kind: "p", text: "When a connected service is not set up for real, its result is simulated, and the product says so. A simulated result means nothing happened outside " + N + "." },
      ],
    },
    {
      id: "you-decide",
      heading: "You stay in charge",
      blocks: [
        { kind: "p", text: "You choose how much your team does on its own, project by project. Whatever you choose, agents never:" },
        { kind: "list", items: ["move money or make payments", "sign anything or accept terms on your behalf", "file anything with your identity, such as tax or company filings", "delete anything permanently", "change your security settings"] },
        { kind: "p", text: "In the Augmented and Assisted modes, an agent asks you before anything that reaches outside your project or costs money. In the Automated mode, agents act within the limits you set, and you can change those limits or pause the team at any time." },
        { kind: "p", text: "You are responsible for what you approve, for the limits you set, and for your project's conduct: what it publishes, sends, sells and promises, and the laws and licenses that apply to your kind of business where you operate." },
      ],
    },
    {
      id: "your-content",
      heading: "What you make is yours",
      blocks: [
        { kind: "p", text: `You keep all rights in what you put into ${N} and in what your team makes for you: ideas, plans, text, code, designs, pages and files ("your content"). As between you and us, what an agent produces for your project belongs to you.` },
        { kind: "p", text: `You give us a worldwide, non-exclusive license to host, copy, process, transmit and display your content only as needed to run ${N} for you and the people you share your project with, to keep it secure and to meet the law. The license ends when your content is deleted, except for copies we must keep by law or that sit in backups until they expire.` },
        { kind: "p", text: "We do not sell your content, and we do not use it to train AI models." },
        { kind: "p", text: "You confirm that you have the rights to what you put in, and that it does not break anyone else's rights. AI output can resemble existing work: check anything important before you publish or register it." },
      ],
    },
    {
      id: "sharing",
      heading: "People, sharing and public pages",
      blocks: [
        { kind: "p", text: "You can build on your own or with others. Cofounders have equal standing in a project; collaborators have limited access. What the people in a project agree among themselves about who owns what is between them; we follow the project's settings." },
        { kind: "p", text: `Your idea and your project stay private until you choose to share them. When you publish a public page or profile, anyone can see it, search engines may index it, and others may copy what they see. ${N} hosts a project's public page at a ${N} address for free.` },
        { kind: "p", text: `We ask AI training crawlers not to collect public project pages and profiles. They may read ${N}'s own pages.` },
      ],
    },
    {
      id: "email-outreach",
      heading: "Email and outreach from your project",
      blocks: [
        { kind: "p", text: `${N} can give your project an address to send email from. Each project has a daily limit, and nothing goes to someone outside your project without your approval.` },
        { kind: "p", text: "You are the sender of your project's emails. Follow the laws on marketing and unsolicited messages where you and your recipients are (such as CAN-SPAM in the United States and the GDPR and ePrivacy rules in the European Union): send only to people you have a lawful reason to contact, say who you are, and stop when someone asks you to." },
      ],
    },
    {
      id: "connected",
      heading: "Services you connect",
      blocks: [
        { kind: "p", text: "You can connect other services to your project, such as a payment provider, a code host or an AI provider with your own key. Those services are run by other companies under their own terms, which you accept with them." },
        { kind: "p", text: "A service you connect with your own key runs on your own account with that company, and that company bills you for it. We keep your keys encrypted and use them only to do what you ask. We are not responsible for other companies' services, their prices or their outages." },
      ],
    },
    {
      id: "acceptable-use",
      heading: "What you may not do",
      blocks: [
        { kind: "p", text: `Do not use ${N}, or have your team do, any of the following:` },
        {
          kind: "list",
          items: [
            "break the law, or help someone else break it",
            "harm, harass, threaten, defraud or deceive people, or impersonate someone",
            "send spam, or contact people who have not agreed to hear from you where the law requires that",
            "make or share sexual content involving minors, content that sexualizes real people without their consent, or content that promotes violence or terrorism",
            "infringe anyone's intellectual property, privacy or other rights",
            "run a regulated activity, such as lending, investment advice, gambling or health care, without the licenses it needs",
            "collect data by scraping sites against their terms, get around logins or solve CAPTCHAs",
            "create malware, attack systems, or probe, overload or get around the security or limits of " + N,
            "open many accounts to get more free credits, or resell access to " + N + " without our written agreement",
            "copy, reverse engineer or rebuild " + N + ", except where the law allows it regardless of these terms",
          ],
        },
        { kind: "p", text: "We may remove content, stop an action or limit an account that breaks these rules, and report illegal activity where the law requires it." },
      ],
    },
    copyrightSection(),
    {
      id: "credits-payment",
      heading: "Plans, credits and payment",
      blocks: [
        { kind: "p", text: `${N} has a free plan. People are free on every plan: there is no charge for cofounders or collaborators. Plans differ only in how much agent work they include.` },
        { kind: "p", text: "Agent work is paid for with credits. The free plan includes credits for one project each month. Included credits are renewed at the start of each calendar month, do not carry over and have no cash value." },
        { kind: "p", text: "You can buy more credits. Prices are shown in US dollars before you pay, and payments are handled by Stripe; we never see your full card number. Credits you buy are added to the project you buy them for and last 12 months from the day you buy them. Each month's included credits are used first, then the credits you bought, oldest first. Prices include taxes where we are required to collect them." },
        { kind: "p", text: "Credits you buy and have not used can be refunded within 14 days of purchase: write to us. Credits that have been used, and included credits, are not refunded. This does not limit any right to a refund you have under the law." },
        { kind: "p", text: "If you are a consumer in the European Union, you have a right to withdraw from a purchase within 14 days. Credits are used as soon as your team works, so by buying credits and starting work you ask us to begin at once; you keep the right to a refund of the credits you have not used in those 14 days." },
        { kind: "p", text: "When paid plans arrive, we will show their prices and terms before you choose one, and we will never move you to a paid plan without your agreement." },
        { kind: "p", text: "If you run your agents on your own AI provider's key, that provider bills you directly and we do not charge credits for that work." },
      ],
    },
    {
      id: "changes-availability",
      heading: "Changes to the service",
      blocks: [
        { kind: "p", text: `${N} is new and changes often. We may add, change or remove features. Some features are marked as early or experimental and may not work as expected. We work to keep ${N} running, but we do not promise it will always be available, fast or free of errors.` },
        { kind: "p", text: "If we stop offering a feature you pay for, we will tell you in advance where we can and refund what you paid for and could not use." },
      ],
    },
    {
      id: "ending",
      heading: "Leaving, and when we can close an account",
      blocks: [
        { kind: "p", text: ["You can stop using ", N, " at any time. You can delete a project in its settings: it is removed 7 days after you ask, so you can change your mind. To close your account and delete your data, write to us at ", mail, "."] },
        { kind: "p", text: "We may suspend or close an account that breaks these terms, puts others at risk or that the law requires us to stop. Unless the law or safety stops us, we will tell you why and give you a chance to respond and to take a copy of your content." },
        { kind: "p", text: "The sections on your content, payment, liability and law continue to apply after an account is closed." },
      ],
    },
    {
      id: "disclaimers",
      heading: "What we are not responsible for",
      blocks: [
        { kind: "p", text: `To the extent the law allows, ${N} is provided "as is" and "as available". We do not promise that it, or what your agents produce, will fit a particular purpose, be accurate or bring any result for your business. You decide what to act on.` },
        { kind: "p", text: "Some places do not allow these disclaimers, so some of them may not apply to you. Nothing in these terms limits rights you have as a consumer that cannot be limited by agreement." },
      ],
    },
    {
      id: "liability",
      heading: "Limits on liability",
      blocks: [
        { kind: "p", text: "To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits, lost revenue, lost data or lost business opportunities, and our total liability to you for all claims about " + N + " is limited to the greater of what you paid us in the 12 months before the claim and 100 US dollars." },
        { kind: "p", text: "These limits do not apply to liability that cannot be limited by law, including for death or personal injury caused by negligence, for fraud, or for damage we cause intentionally or through gross negligence." },
        { kind: "p", text: `If you use ${N} for a business and not as a consumer, you agree to compensate us for claims by others that arise from your content or from your breach of these terms.` },
      ],
    },
    {
      id: "law",
      heading: "Law and disputes",
      blocks: [
        { kind: "p", text: "These terms are governed by the laws of Sweden, without regard to its rules on conflicts of laws. Disputes are settled by the courts of Sweden." },
        { kind: "p", text: "If you are a consumer, you also keep the protection of the mandatory laws of the country where you live, and you may bring a claim in the courts there. Consumers in Sweden can also turn to the National Board for Consumer Disputes (Allmänna reklamationsnämnden)." },
        { kind: "p", text: ["Please write to us first at ", mail, ": most problems are quicker to solve together."] },
      ],
    },
    {
      id: "changes-terms",
      heading: "Changes to these terms",
      blocks: [
        { kind: "p", text: "We may update these terms as the product and the law change. For a change that matters to you, we will tell you by email or in the product at least 30 days before it takes effect, unless the law requires it sooner. If you do not agree, you can close your account before then. The date at the top shows when the terms last changed." },
        { kind: "p", text: "If a part of these terms cannot be enforced, the rest still applies. If we do not enforce a part at once, we can still enforce it later. You may not transfer these terms without our agreement; we may transfer them to a company that takes over " + N + ", and we will tell you if we do." },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        { kind: "p", text: [`${LEGAL_ENTITY.name} runs ${N}. Write to us at `, mail, "."] },
        { kind: "p", text: entityLine() + "." },
      ],
    },
  ],
};
