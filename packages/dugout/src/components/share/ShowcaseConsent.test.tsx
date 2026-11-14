import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
import { ShowcaseConsent, type ShowcaseConsentView } from "./ShowcaseConsent";

const view: ShowcaseConsentView = {
  projectName: "Maple Bakes",
  postText: "How Maple Bakes was built. Page live on Nov 12, 2026.",
  link: "https://foundmill.example/p/maple-bakes/story?via=p.maple-bakes",
  networks: ["instagram", "tiktok"],
  clips: [{ url: "https://foundmill.example/clip.mp4", caption: "Nov 12: page live" }],
  answer: null,
  withdrawn: false,
  state: "asking",
  expiresOn: "Nov 28, 2026",
  canAnswer: true,
  canWithdraw: false,
};

describe("ShowcaseConsent", () => {
  it("shows exactly what would be posted, and the sentence that it cannot be pulled back", () => {
    render(<ShowcaseConsent view={view} appName={APP_NAME} />);
    expect(screen.getByTestId("showcase-post").textContent).toBe(view.postText);
    expect(screen.getByTestId("showcase-link").getAttribute("href")).toBe(view.link);
    expect(screen.getByTestId("showcase-networks").textContent).toBe("Instagram, TikTok");
    expect(screen.getByTestId("showcase-video").querySelector("video")?.getAttribute("src")).toBe("https://foundmill.example/clip.mp4");
    expect(screen.getByTestId("showcase-recall").textContent).toBe(`You can withdraw any time before it's posted. Once ${APP_NAME} posts it, it can't be pulled back from those networks.`);
    expect(screen.getByTestId("showcase-state").textContent).toBe("This ask stays open until Nov 28, 2026.");
  });

  it("answers yes or no; once answered yes, offers to withdraw", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<ShowcaseConsent view={view} appName={APP_NAME} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, post it" }));
    fireEvent.click(screen.getByRole("button", { name: "No, thanks" }));
    expect(onAnswer.mock.calls).toEqual([["yes"], ["no"]]);
    const onWithdraw = vi.fn();
    rerender(<ShowcaseConsent view={{ ...view, answer: "yes", canAnswer: false, canWithdraw: true }} appName={APP_NAME} onWithdraw={onWithdraw} />);
    expect(screen.queryByRole("button", { name: "Yes, post it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw my yes" }));
    expect(onWithdraw).toHaveBeenCalledOnce();
  });

  it("says plainly when the video was withdrawn and its media deleted", () => {
    render(<ShowcaseConsent view={{ ...view, state: "withdrawn", clips: [], canAnswer: false, answer: "yes", withdrawn: true }} appName={APP_NAME} />);
    expect(screen.getByTestId("showcase-video").textContent).toMatch(/no longer available/);
    expect(screen.getByTestId("showcase-state").textContent).toBe("Not posted: withdrawn");
  });
});
