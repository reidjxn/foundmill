import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LOOKING_FOR_OPTIONS, LOOKING_FOR_QUESTION, PERSON_TAGS_MAX, PERSON_TAG_MAX } from "@foundmill/shared/person-profile";
import { FIRST_PROFILE_STRENGTHS, FirstProfileForm, type FirstProfileFormProps, type FirstProfileValues } from "./FirstProfileForm";

/**
 * What a new person answers after a kept card (WP-04 T1; time and where they live, WP-14 T2), at the two widths it is checked at: 390 px (a phone) and 1440 px.
 * The frame sets the width; the form lays itself out from its container (`@page-wide`).
 */
const meta = {
  title: "Guidance/First profile",
  component: FirstProfileForm,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        phone390: { name: "390 px", styles: { width: "390px", height: "844px" }, type: "mobile" },
        wide1440: { name: "1440 px", styles: { width: "1440px", height: "900px" }, type: "desktop" },
      },
    },
    docs: {
      description: {
        component:
          "What a new person tells their team: what to call them (prefilled, required), what they are good at or enjoy (optional tags, one suggestion for each skill), how much time they can give and where they live (optional here, required before starting a project), and what they are here for (building on their own by default, people one answer among the others), then the 18 or older box and Continue. Pure: the screen saves.",
      },
    },
  },
  args: {
    values: { name: "Maya Okafor", strengths: [], lookingFor: "on_my_own", time: "", place: "" },
    onChange: () => undefined,
    onSubmit: () => undefined,
    strengthSuggestions: FIRST_PROFILE_STRENGTHS,
    lookingForQuestion: LOOKING_FOR_QUESTION,
    lookingForOptions: LOOKING_FOR_OPTIONS,
    timeOptions: [
      { value: "full_time", label: "Full time", description: "40 hours a week or more." },
      { value: "part_time", label: "Part time", description: "15 to 30 hours a week." },
      { value: "evenings_weekends", label: "Evenings and weekends", description: "Around 10 hours a week." },
      { value: "few_hours", label: "A few hours a week", description: "The team does most of the work." },
    ],
    placeSuggestions: ["Canada", "United Kingdom", "United States"],
    maxTags: PERSON_TAGS_MAX,
    maxTagLength: PERSON_TAG_MAX,
    askAdult: true,
  },
  render: function Stateful(args: FirstProfileFormProps) {
    const [values, setValues] = useState<FirstProfileValues>(args.values);
    return <FirstProfileForm {...args} values={values} onChange={setValues} />;
  },
} satisfies Meta<typeof FirstProfileForm>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line bg-canvas p-gutter">
    <Story />
  </div>
);
const Wide: Decorator = (Story) => (
  <div className="@container flex w-full justify-center bg-canvas p-gutter">
    <Story />
  </div>
);

export const Phone390: Story = { name: "390 px", decorators: [Phone], globals: { viewport: { value: "phone390" } } };

export const Wide1440: Story = { name: "1440 px", decorators: [Wide], globals: { viewport: { value: "wide1440" } } };

export const Answered390: Story = {
  name: "390 px · answered",
  decorators: [Phone],
  globals: { viewport: { value: "phone390" } },
  args: { values: { name: "Maya Okafor", strengths: ["Product and brand", "Baking"], lookingFor: "looking_for_cofounder", time: "evenings_weekends", place: "Canada" } },
};

export const Answered1440: Story = {
  name: "1440 px · answered",
  decorators: [Wide],
  globals: { viewport: { value: "wide1440" } },
  args: { values: { name: "Maya Okafor", strengths: ["Finding and winning customers", "I know my market"], lookingFor: "open_to_people", time: "full_time", place: "United Kingdom" } },
};

export const AlreadyConfirmed390: Story = { name: "390 px · 18 or older already on record", decorators: [Phone], globals: { viewport: { value: "phone390" } }, args: { askAdult: false } };

export const SaveFailed390: Story = {
  name: "390 px · the save did not go through",
  decorators: [Phone],
  globals: { viewport: { value: "phone390" } },
  args: { error: "The server took too long to answer. Try again." },
};
