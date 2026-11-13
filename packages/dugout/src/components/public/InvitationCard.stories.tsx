import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { INVITATION_OTHER_ADDRESS_WORDS, INVITATION_ROLE_SENTENCE } from "@foundmill/shared/people";
import { Button } from "../foundation/Button";
import { InvitationCard } from "./InvitationCard";

/** An invitation to a project at `/i/<token>`, at phone width, in each state it can show (package 3.1). */
const meta = {
  title: "Public/InvitationCard",
  component: InvitationCard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Who invited you, to what, as what (one plain sentence for the role), and the way on: Accept and Not now, or Sign in to accept. Every invitation that no longer works reads the same and names nobody; an invitation to an address, met by another account, keeps its card and says under the actions to sign in with the address it was sent to. While the page asks it reads Opening; when too many people opened links at once it says to try again in a minute, never that the invitation is dead. Server-safe; the caller passes the actions. Every control is at least 44 px tall.",
      },
    },
  },
  args: { state: "pending", projectName: "Bread by Bike", inviterName: "Maya Lee", roleWord: "Cofounder", roleSentence: INVITATION_ROLE_SENTENCE.cofounder },
} satisfies Meta<typeof InvitationCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone bg-canvas px-gutter py-6">
    <Story />
  </div>
);
const actions = (
  <>
    <Button variant="primary" size="lg" className="min-h-tap">
      Accept
    </Button>
    <Button variant="ghost" size="lg" className="min-h-tap">
      Not now
    </Button>
  </>
);

export const Cofounder390: Story = { name: "390 px · as a cofounder", decorators: [Phone], args: { actions } };
export const Collaborator390: Story = { name: "390 px · as a collaborator", decorators: [Phone], args: { roleWord: "Collaborator", roleSentence: INVITATION_ROLE_SENTENCE.collaborator, actions } };
export const SignedOut390: Story = {
  name: "390 px · signed out",
  decorators: [Phone],
  args: {
    actions: (
      <Button asChild variant="primary" size="lg" className="min-h-tap">
        <a href="#login">Sign in to accept</a>
      </Button>
    ),
  },
};
export const OtherAddress390: Story = {
  name: "390 px · signed in with another address",
  decorators: [Phone],
  args: {
    actions: (
      <>
        {actions}
        <Button variant="ghost" size="lg" className="min-h-tap text-secondary">
          Decline
        </Button>
      </>
    ),
    note: INVITATION_OTHER_ADDRESS_WORDS,
  },
};
export const NoInviterName390: Story = { name: "390 px · the inviter has no name yet", decorators: [Phone], args: { inviterName: null, actions } };
export const Unavailable390: Story = { name: "390 px · no longer works", decorators: [Phone], args: { state: "unavailable", projectName: null, inviterName: null } };
export const Declined390: Story = { name: "390 px · declined", decorators: [Phone], args: { state: "declined" } };
export const Checking390: Story = { name: "390 px · opening", decorators: [Phone], args: { state: "checking", projectName: null, inviterName: null } };
export const Busy390: Story = {
  name: "390 px · too many people at once",
  decorators: [Phone],
  args: {
    state: "busy",
    projectName: null,
    inviterName: null,
    actions: (
      <Button variant="secondary" size="lg" className="min-h-tap">
        Try again
      </Button>
    ),
  },
};
export const Desktop: Story = { name: "1280 px", decorators: [(Story) => <div className="@container w-[480px] bg-canvas p-6"><Story /></div>], args: { actions } };
