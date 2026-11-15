import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fan } from "lucide-react";
import { Icon } from "../../components/foundation/Icon";

/**
 * The landing page's idea button (DESIGN §9a). Filled is the built look (founder, 2026-11-15): flat brand primary, the
 * page's one filled thing. Recorded is the dark outlined look of 2026-11-13, kept behind `IDEA_BUTTON = "recorded"`.
 */
const meta = { title: "Landing/Idea button", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj;

const Row = ({ disabled = false }: { disabled?: boolean }) => (
  <div className="landing-page flex flex-wrap items-center gap-6 p-6">
    <button type="button" className="idea-gen-filled" disabled={disabled}>
      <Icon icon={Fan} size={18} />
      Shape my idea
    </button>
    <button type="button" className="idea-gen min-h-tap px-4" disabled={disabled}>
      <span className="idea-gen-core">
        <Icon icon={Fan} size={18} />
      </span>
      Shape my idea
    </button>
  </div>
);

export const FilledAndRecorded: Story = { name: "Filled (built) and recorded", render: () => <Row /> };
export const Disabled: Story = { render: () => <Row disabled /> };
