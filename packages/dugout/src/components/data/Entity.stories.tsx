import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Bot, Mail } from "lucide-react";
import {
  ENTITY_KIND_LABELS,
  EntityCard,
  EntityLink,
  EntityLinkProvider,
  type EntityLinkContextValue,
} from "./EntityLink";
import { EntityText } from "./EntityText";
import { Markdown } from "./Markdown";
import type { EntityRenderNode } from "./entityMarkup";
import {
  ENTITY_DETAILS,
  ENTITY_IDS,
  ENTITY_KIND_SAMPLE,
  NOTE_MARKDOWN,
  NOTE_WITH_MARKUP,
  resolveFixtureEntity,
} from "./fixtures";

function useLog() {
  const [log, setLog] = useState<string[]>([]);
  return { log, note: (s: string) => setLog((l) => [s, ...l].slice(0, 5)) };
}

function Provider({ children, note }: { children: React.ReactNode; note: (s: string) => void }) {
  const value: EntityLinkContextValue = {
    resolve: (id) => {
      const d = resolveFixtureEntity(id);
      return d
        ? {
            ...d,
            actions: [
              {
                id: "msg",
                label: "Message",
                icon: Mail,
                onSelect: (e) => note(`Message ${e.name}`),
              },
              {
                id: "assign",
                label: "Assign agent",
                icon: Bot,
                onSelect: (e) => note(`Assign agent to ${e.name}`),
              },
            ],
          }
        : undefined;
    },
    hrefFor: (e) => `#crm/${e.id}`,
    onOpen: (e) => note(`Open ${e.name}`),
    onVerb: (verb, e) => note(`${verb} → ${e.name}`),
  };
  return <EntityLinkProvider value={value}>{children}</EntityLinkProvider>;
}

const meta = {
  title: "Data/EntityLink",
  component: EntityLink,
} satisfies Meta<typeof EntityLink>;
export default meta;

type Story = StoryObj<typeof meta>;

function KindsDemo() {
  const { log, note } = useLog();
  return (
    <Provider note={note}>
      <div className="flex flex-col gap-3">
        <p className="text-body text-secondary">
          Every kind reads as plain underlined text in the sentence's colour. Hover for the card (300 ms), click to
          open, right-click for verbs.
        </p>
        <ul className="flex flex-wrap gap-4">
          {Object.values(ENTITY_DETAILS).map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <EntityLink entity={d} />
              <span className="text-small text-secondary">{ENTITY_KIND_LABELS[d.kind]}</span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-4">
          {ENTITY_KIND_SAMPLE.map((kind) => (
            <li key={kind}>
              <EntityLink entity={{ id: `k-${kind}`, kind, name: ENTITY_KIND_LABELS[kind] }} />
            </li>
          ))}
        </ul>
        <p className="text-small text-secondary" aria-live="polite">
          {log.join(" · ")}
        </p>
      </div>
    </Provider>
  );
}

export const Kinds: Story = {
  args: { entity: { id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist" } },
  render: () => <KindsDemo />,
};

export const HoverCardInline: Story = {
  args: { entity: { id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist" } },
  render: () => (
    <div className="grid w-fit grid-cols-2 gap-gutter">
      <div className="surface-overlay w-80 p-3">
        <EntityCard details={ENTITY_DETAILS[ENTITY_IDS.nordic]!} />
      </div>
      <div className="surface-overlay w-80 p-3">
        <EntityCard details={ENTITY_DETAILS[ENTITY_IDS.scout]!} />
      </div>
    </div>
  ),
};

const AMBIGUOUS_AND_DRAFT: EntityRenderNode[] = [
  { type: "entity", id: ENTITY_IDS.scout, display: "Scout", kind: "agent" },
  { type: "text", text: " spoke with " },
  {
    type: "ambiguous",
    text: "Sara",
    prompt: "Which one?",
    decoration: "dotted-underline",
    candidates: [
      { id: ENTITY_IDS.sara, name: "Sara Lindqvist", kind: "person", score: 1, tier: "partial" },
      { id: ENTITY_IDS.amara, name: "Sara Holm", kind: "person", score: 0.6, tier: "partial" },
    ],
  },
  { type: "text", text: " at " },
  { type: "entity", id: ENTITY_IDS.nordic, display: "Nordic Beauty AB", kind: "organisation" },
  { type: "text", text: " about stocking 23 stores, and " },
  { type: "draft", name: "Kalla Apotek", kindGuess: "organisation", flag: "unverified" },
  { type: "text", text: " asked for a sample kit. " },
  { type: "entity", id: ENTITY_IDS.reid, display: "Reid", kind: "team_member" },
  { type: "text", text: " should decide on the reorder by Friday." },
];

function ParagraphDemo() {
  const { log, note } = useLog();
  return (
    <Provider note={note}>
      <div className="flex max-w-reading flex-col gap-4">
        <EntityText
          as="p"
          className="t-reading text-primary"
          onResolveAmbiguous={(n, c) => note(`"${n.text}" → ${c.name}`)}
          onCreateDraft={(n) => note(`Create ${n.kindGuess} "${n.name}"`)}
        >
          {AMBIGUOUS_AND_DRAFT}
        </EntityText>
        <div>
          <p className="t-label mb-1">From markup text</p>
          <EntityText as="p" className="text-body text-primary">
            {NOTE_WITH_MARKUP}
          </EntityText>
        </div>
        <p className="text-small text-secondary" aria-live="polite">
          {log.join(" · ")}
        </p>
      </div>
    </Provider>
  );
}

/** A paragraph with person, organisation, agent and team-member links, one ambiguous span and one unverified draft. */
export const EntityTextParagraph: Story = {
  args: { entity: { id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist" } },
  render: () => <ParagraphDemo />,
};

function MarkdownDemo() {
  const { log, note } = useLog();
  return (
    <Provider note={note}>
      <div className="surface-panel p-4">
        <Markdown>{NOTE_MARKDOWN}</Markdown>
      </div>
      <p className="mt-2 text-small text-secondary" aria-live="polite">
        {log.join(" · ")}
      </p>
    </Provider>
  );
}

export const MarkdownNote: Story = {
  args: { entity: { id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist" } },
  render: () => <MarkdownDemo />,
};

/** Text written by other people (a community post): `entities={false}` never links a mention and `images={false}` never fetches an image. */
export const MarkdownWithoutImages: Story = {
  args: { entity: { id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist" } },
  render: () => (
    <div className="surface-panel max-w-md p-4">
      <Markdown variant="body" images={false} entities={false}>
        {"Our funnel after the change: ![funnel chart](https://example.com/funnel.png). **Replies halved** at [[ent:11111111-1111-4111-8111-111111111111|Acme Ltd]]; details in [the write-up](https://example.com/notes)."}
      </Markdown>
    </div>
  ),
};
