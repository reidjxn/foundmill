import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetricTile } from "../data/MetricTile";
import { Button } from "../foundation/Button";
import { ProvenanceChip } from "../foundation/Chip";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { Skeleton } from "../foundation/Skeleton";
import { Panel } from "../shell/Panel";
import { ConsequenceLine } from "./ConsequenceLine";
import { Explainer } from "./Explainer";
import { GuidanceProvider, type GuidanceMode } from "./GuidanceProvider";
import { InfoTip } from "./InfoTip";
import { LearnLinkProvider } from "./LearnLink";
import { PlainFigure } from "./PlainFigure";
import { ReassuranceLine } from "./ReassuranceLine";
import { ScaleLabel } from "./ScaleLabel";
import { Term } from "./Term";
import { FIXTURE_TERMS } from "./fixtures";

/** Every guidance primitive on one screen, under one provider. */
function Sampler({ guidance }: { guidance: GuidanceMode }) {
  return (
    <LearnLinkProvider resolve={(learn) => (/^https?:/.test(learn) ? learn : `#${learn}`)}>
      <GuidanceProvider value={{ guidance, terms: FIXTURE_TERMS }}>
        <Panel title={guidance === "on" ? "Guidance on" : "Guidance off"} meta="Home" help="What each primitive does with the switch in this position.">
          <div className="flex flex-col gap-4">
            <Explainer
              screenId={`sampler-${guidance}`}
              purpose="Your business at a glance."
              action="Read the notes, then press Continue."
              watchFor="The runway tile turning amber."
              onExample={() => {}}
            />
            <p className="text-body text-secondary">
              Your <Term id="runway">runway</Term> is 7 months <ProvenanceChip kind="estimate" appearance="word" />. Each <Term id="cycle">cycle</Term> reports back in the Inbox.
            </p>
            <div className="flex items-end gap-6">
              <PlainFigure metricId="runway">
                <span className="t-display-lg text-primary">7 mo</span>
              </PlainFigure>
              <MetricTile label="MRR" value={{ amountMinor: 184000, currency: "GBP" }} metricId="mrr" estimate="estimate" className="surface-panel w-56" />
            </div>
            <div className="flex items-center gap-3 text-body">
              <span className="text-secondary">Planning</span>
              <span className="t-display-sm text-rating-4">17</span>
              <ScaleLabel value={17} />
              <span className="ml-4 text-secondary">Field</span>
              <InfoTip label="Field">A sentence about the field.</InfoTip>
            </div>
            <Field htmlFor={`biz-${guidance}`} label="Business name" help="The name customers see; you can rename it later.">
              <Input id={`biz-${guidance}`} defaultValue="Northwind Skincare" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <Button variant="danger" className="w-fit">
                Stop all agents
              </Button>
              <ConsequenceLine consequence="Every running task stops where it is." cost="No cost" reversible />
              <ReassuranceLine>Press Continue to start them again.</ReassuranceLine>
            </div>
            <Skeleton className="w-48" label="Queued for Teodor" />
          </div>
        </Panel>
      </GuidanceProvider>
    </LearnLinkProvider>
  );
}

const meta = {
  title: "Guidance/Overview",
  component: Sampler,
  args: { guidance: "on" },
  parameters: {
    docs: {
      description: {
        component:
          "The guided layer in one place (UX plan §6). One switch, `account_preferences.guidance`, read through `GuidanceProvider`. **Off hides tutoring, never information**: Term underlines, InfoTip, Explainer, ReassuranceLine and PlainFigure's line go; ConsequenceLine, ScaleLabel, Estimate / Forecast and their definitions stay. Dotted means something to learn; dashed means not measured.",
      },
    },
  },
} satisfies Meta<typeof Sampler>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = { args: { guidance: "on" } };
export const Off: Story = { args: { guidance: "off" } };

/** The two states side by side. */
export const SideBySide: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-gutter">
      <Sampler guidance="on" />
      <Sampler guidance="off" />
    </div>
  ),
};

/** Comfortable text (`data-text="comfortable"` on the root): body 14/20, small 12.5/16, chat 14/21; the structure keeps its sizes. */
export const ComfortableText: Story = {
  name: "Comfortable text",
  render: () => (
    <div className="grid grid-cols-2 gap-gutter">
      <div>
        <p className="t-data mb-2">Standard</p>
        <Sampler guidance="on" />
      </div>
      <div data-text="comfortable" style={{ "--fs-body": "14px", "--lh-body": "20px", "--fs-small": "12.5px", "--lh-small": "16px", "--fs-chat": "14px", "--lh-chat": "21px" } as CSSProperties}>
        <p className="t-data mb-2">Comfortable</p>
        <Sampler guidance="on" />
      </div>
    </div>
  ),
};
