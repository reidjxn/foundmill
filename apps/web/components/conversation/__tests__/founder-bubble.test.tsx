// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { EntityLinkProvider, preloadMarkdown } from "@foundmill/dugout";
import { renderBubble, renderFounderBubble } from "../AgentConversation";

const FAKE = "00000000-0000-4000-8000-000000000000";
const TYPED = `Is [[ent:${FAKE}|Fake Co]] a competitor? Also *really* <i>urgent</i>`;

beforeAll(() => preloadMarkdown());

describe("what the founder typed is never entity markup (audit FR-23)", () => {
  it("a typed [[ent:…]] shows as its name, not as a link to nothing, while an agent's own mention still links", () => {
    const { container, unmount } = render(<EntityLinkProvider value={{}}>{renderFounderBubble(TYPED)}</EntityLinkProvider>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Is Fake Co a competitor?");
    expect(container.textContent).not.toContain("[[ent:");
    unmount();

    const agent = render(<EntityLinkProvider value={{}}>{renderBubble(`Ask [[ent:${FAKE}|Fake Co]] first.`)}</EntityLinkProvider>);
    expect(agent.container.querySelector("a")).not.toBeNull();
  });

  it("keeps Markdown in the founder's words, and plain words plain", () => {
    const { container } = render(<>{renderFounderBubble("Is it **really** so?")}</>);
    expect(container.textContent).toBe("Is it really so?");
    expect(container.querySelector("strong")?.textContent).toBe("really");
    const plain = render(<>{renderFounderBubble("Just a question")}</>);
    expect(plain.container.textContent).toBe("Just a question");
  });
});
