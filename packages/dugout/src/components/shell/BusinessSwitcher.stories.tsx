import type { Meta, StoryObj } from "@storybook/react-vite";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { kitStyle } from "./KitBar";
import { MANY_SWITCHER_BUSINESSES, NORTHWIND_KIT, SWITCHER_BUSINESSES } from "./fixtures";

const actions = { onOpenBusiness: () => {}, onNewBusiness: () => {}, onManageBusinesses: () => {}, onProfile: () => {} };

const meta = {
  title: "Shell/Business switcher",
  component: BusinessSwitcher,
  parameters: {
    layout: "padded",
    docs: { description: { component: "The top bar's logo and name as the business switcher: a chevron after the name and the tooltip “Switch business”. A glass popover headed “Switch business” lists the founder's businesses (24 px logos, the current one first and checked, then A to Z, role and Demo chips), a “Find a business…” filter from six businesses, then Create a new business, Manage businesses, Home and Your profile." } },
  },
  args: {
    businessName: "Northwind Skincare",
    menu: { businesses: SWITCHER_BUSINESSES, ...actions },
    onHome: () => {},
    defaultOpen: true,
    children: (
      <span className="flex min-w-0 items-center gap-2.5">
        <BusinessLogo src={SAMPLE_LOGOS.stack} name="Northwind Skincare" primary={NORTHWIND_KIT.primary} size={32} />
        <span className="t-display-sm leading-tight">Northwind Skincare</span>
      </span>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 520 }}>
        <div className="kitbar-slab inline-flex rounded-md p-3 text-kit-on-primary" style={kitStyle(NORTHWIND_KIT)}>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof BusinessSwitcher>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FewBusinesses: Story = { name: "Few businesses" };
/** From six businesses a filter field leads the list and takes the focus. */
export const ManyBusinesses: Story = { name: "Many businesses", args: { menu: { businesses: MANY_SWITCHER_BUSINESSES, ...actions } } };
/** The list loads only once the founder reaches for it: the current business shows at once, the rest as a skeleton. */
export const Loading: Story = { name: "Loading the list", args: { menu: { businesses: SWITCHER_BUSINESSES.slice(0, 1), loading: true, ...actions } } };
export const OnlyOne: Story = { name: "Only one business", args: { menu: { businesses: SWITCHER_BUSINESSES.slice(0, 1), ...actions } } };
/** After a pick: a spinner in place of the chevron until the other business replaces the page. */
export const Opening: Story = { name: "Opening another business", args: { defaultOpen: false, menu: { businesses: SWITCHER_BUSINESSES, pendingBusinessId: "lg", ...actions } } };
export const ListError: Story = { name: "List did not load", args: { menu: { businesses: SWITCHER_BUSINESSES.slice(0, 1), error: "Could not load your other businesses.", onRetry: () => {}, ...actions } } };
/** Closed, as the top bar shows it: hover for the tooltip. */
export const Closed: Story = { args: { defaultOpen: false } };
