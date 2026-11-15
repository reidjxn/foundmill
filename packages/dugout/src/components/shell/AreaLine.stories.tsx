import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntityLinkProvider } from "../data/EntityLink";
import { AreaLine } from "./AreaLine";

const COS = "11111111-1111-4111-8111-111111111111";

const meta = {
  title: "Shell/AreaLine",
  component: AreaLine,
  parameters: {
    docs: {
      description: {
        component:
          "The opening line of a founder area (DESIGN §9): one plain sentence first on every tab of Plan, Customers, Money, Product and Team, built from the same figures as the tiles under it. The closing figure's Estimate or Forecast chip follows the words; Money adds its Company line; a department with a name of its own gets the kind line (“Formulation Lab is part of Product.”). A string may carry `[[ent:id|Name]]` mentions, rendered as EntityLinks. Information, so it shows with guidance off too.",
      },
    },
  },
  args: { area: "Money", sentence: "You have £25K and spend about £18K a month, so you have about 1.4 months of cash.", provenance: "estimate" },
  decorators: [(Story) => <div className="w-[60rem] p-4"><Story /></div>],
} satisfies Meta<typeof AreaLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Money: Story = {
  args: { sections: [{ id: "company", label: "Company", sentence: "Northwind Ltd: 2 filings are due in the next 30 days, the first on Dec 1." }] },
};
export const MoneyNoBank: Story = { name: "Money, no bank yet", args: { sentence: "Connect your bank and this line shows your cash and how long it lasts.", provenance: null, sections: [{ id: "company", label: "Company", sentence: "Your company is not incorporated yet." }] } };
export const Plan: Story = {
  args: { area: "Plan", sentence: "Your goal: get the first 10 paying customers by Dec 19. 4 of 10 so far, 40 days left: on pace (Forecast). 3 things are in Now; the next is due Dec 4.", provenance: "estimate" },
};
export const Customers: Story = { args: { area: "Customers", sentence: "In the last 35 days: 42 new leads and 6 new paying customers, most from Lead generation. 2 campaigns are live.", provenance: null, kind: "Retail Partnerships is part of Customers." } };
export const BeforeSelling: Story = { name: "Customers, before selling", args: { area: "Customers", sentence: "Selling has not started yet.", provenance: null } };
export const Product: Story = { args: { area: "Product", sentence: "3 changes went live in the last 7 days and 2 wait for your go-ahead.", provenance: null, kind: "Formulation Lab is part of Product." } };
export const Team: Story = {
  args: { area: "Team", sentence: `[[ent:${COS}|Ines Park]], your Chief of Staff, runs 6 leads and 23 specialists; 2 are down or failing.`, provenance: null },
  decorators: [(Story) => <EntityLinkProvider value={{ resolve: (id) => (id === COS ? { id, kind: "agent", name: "Ines Park", subtitle: "Chief of Staff" } : undefined), hrefFor: () => "#" }}><Story /></EntityLinkProvider>],
};
export const Loading: Story = { args: { area: "Product", sentence: null, provenance: null, loading: true } };
