import type { Meta, StoryObj } from "@storybook/react-vite";
import { PERSONAS } from "@foundmill/shared/personas";
import { AgentPersonaProvider, useAgentPersona } from "./AgentPersona";
import { Avatar } from "./Avatar";

const FACE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#c9b8a6"/><circle cx="20" cy="16" r="7" fill="#e8c9a8"/><ellipse cx="20" cy="38" rx="13" ry="10" fill="#3a4a63"/></svg>');

const AGENTS = [
  { name: "Chief of Staff", role: "Chief of Staff", personaKey: PERSONAS[1]!.key, seed: "cos", dept: "dept-1" as const },
  { name: "Growth Lead", role: "Head of Growth", personaKey: PERSONAS[0]!.key, seed: "gl", dept: "dept-3" as const },
  { name: "Support Agent", role: null, personaKey: null, seed: "sa", dept: "dept-5" as const },
];

function Sampler() {
  const persona = useAgentPersona();
  return (
    <div className="surface-panel flex w-96 flex-col gap-2 p-panel-pad">
      <p className="t-label">{persona.anthropomorphic ? "Anthropomorphic agents: on" : "Anthropomorphic agents: off"}</p>
      {AGENTS.map((a) => (
        <div key={a.seed} className="flex items-center gap-3">
          <Avatar size={32} name={persona.nameFor(a)} agent={{ seed: a.seed, dept: a.dept, personaKey: a.personaKey }} status="healthy" />
          <div className="min-w-0">
            <p className="truncate text-body text-primary">{persona.labelFor(a)}</p>
            <p className="truncate text-small text-secondary">nameFor: {persona.nameFor(a)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Foundation/AgentPersonaProvider",
  component: AgentPersonaProvider,
  parameters: {
    docs: {
      description: {
        component:
          "The display layer for anthropomorphic agents. With the preference on, `nameFor` is the persona's first name, `labelFor` is \"Bob (Chief of Staff)\" (the position always stays visible: agents are still AI agents) and the Avatar shows the AI-generated face when it exists. Off, or outside a provider, every value is today's.",
      },
    },
  },
  args: { anthropomorphic: true, portraitUrl: (): string | null => FACE },
} satisfies Meta<typeof AgentPersonaProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = { render: (args) => <AgentPersonaProvider {...args}><Sampler /></AgentPersonaProvider> };
export const Off: Story = { args: { anthropomorphic: false }, render: (args) => <AgentPersonaProvider {...args}><Sampler /></AgentPersonaProvider> };
/** Faces are made in the background: until one is ready the drawn portrait stands in. */
export const FacesNotReadyYet: Story = { args: { portraitUrl: () => null }, render: (args) => <AgentPersonaProvider {...args}><Sampler /></AgentPersonaProvider> };
