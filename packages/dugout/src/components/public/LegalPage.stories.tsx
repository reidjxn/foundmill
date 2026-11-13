import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { LegalPage, type LegalDocument } from "./LegalPage";

/**
 * The Terms of Service and the Privacy Policy at the two widths they are checked at: 390 px (a phone) and 1280 px. The
 * frame sets the width; the page lays itself out from its own width (a container query).
 */
const sample: LegalDocument = {
  title: "Privacy Policy",
  updated: "Nov 13, 2026",
  summary: [
    "We collect what we need to run your account and your projects, and nothing for advertising.",
    "We do not sell your personal data, and we do not use your content to train AI models.",
    ["You can ask to see, correct, export or delete your data at any time: write to ", { text: "privacy@example.com", href: "mailto:privacy@example.com" }, "."],
  ],
  sections: [
    {
      id: "what-we-collect",
      heading: "What we collect",
      blocks: [
        { kind: "p", text: "What you give us:" },
        {
          kind: "terms",
          items: [
            { term: "Account", detail: "Your email address, your name and how you sign in." },
            { term: "Projects", detail: "Your ideas and everything your team makes and does." },
          ],
        },
      ],
    },
    {
      id: "eu-rights",
      heading: "Your rights in the European Union and the UK",
      blocks: [
        { kind: "p", text: "Under the GDPR you have the right to:" },
        { kind: "list", items: ["see the personal data we hold about you and get a copy", "correct it if it is wrong", "have it deleted"] },
      ],
    },
    { id: "contact", heading: "Contact", blocks: [{ kind: "p", text: ["Write to ", { text: "privacy@example.com", href: "mailto:privacy@example.com" }, ". See also the ", { text: "Terms of Service", href: "/terms" }, "."] }] },
  ],
};

const meta = {
  title: "Public/LegalPage",
  component: LegalPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Terms of Service at `/terms` and the Privacy Policy at `/privacy`: the product's name and the two documents in a bar, the title and the date, “The short version”, the contents as anchors, and numbered sections. The text is structured data (paragraphs, lists, and names with what each means), every string a text node; a link is an in-site path, https or mailto, anything else is printed as text. Server-safe.",
      },
    },
  },
  args: {
    document: sample,
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy", current: true },
    ],
  },
} satisfies Meta<typeof LegalPage>;
export default meta;

type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="w-phone border-x border-line">
    <Story />
  </div>
);
const Desktop: Decorator = (Story) => (
  <div className="w-desktop">
    <Story />
  </div>
);

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Desktop1280: Story = { name: "1280 px", decorators: [Desktop] };
export const Terms1280: Story = {
  name: "1280 px · the Terms, no short version",
  decorators: [Desktop],
  args: {
    document: { ...sample, title: "Terms of Service", summary: [] },
    links: [
      { href: "/terms", label: "Terms", current: true },
      { href: "/privacy", label: "Privacy" },
    ],
  },
};
