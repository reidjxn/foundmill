import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../foundation/Avatar";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { Term } from "../guidance/Term";
import { ProfileHeader } from "./ProfileHeader";

describe("ProfileHeader facts", () => {
  it("takes a node label (a Term on the first mention of a defined word), keyed by its id", () => {
    render(
      <GuidanceProvider value={{ guidance: "on", terms: { line_manager: { id: "line_manager", word: "Line manager", short: "The agent or person this agent reports to." } } }}>
        <ProfileHeader
          avatar={<Avatar name="Scout" size={64} />}
          name="Scout"
          facts={[
            { id: "line-manager", label: <Term id="line_manager">Line manager</Term>, value: "Chief of Staff" },
            { label: "Tasks", value: "42" },
          ]}
        />
      </GuidanceProvider>,
    );
    const labels = [...screen.getByTestId("profile-facts").querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["Line manager", "Tasks"]);
    // The Term renders its own trigger inside the label.
    expect(screen.getByTestId("profile-facts").querySelector("dt [data-term]")).toBeTruthy();
    expect(screen.getByText("Chief of Staff")).toBeTruthy();
  });
});
