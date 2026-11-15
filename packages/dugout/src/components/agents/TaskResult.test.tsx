import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { preloadMarkdown } from "../data/Markdown";
import { TaskResult, TASK_RESULT_SIMULATED } from "./TaskResult";

const AGENT = "22222222-2222-4222-8222-222222222222";

beforeAll(() => preloadMarkdown());

describe("TaskResult", () => {
  it("shows the title, the body as Markdown with mentions linked, and the sources as links that open a new tab", async () => {
    const { container } = render(
      <TaskResult
        title="Refill pricing: three rivals"
        bodyMd={`## Findings\n\n- [[ent:${AGENT}|Ada]] found **two** rivals under £35 (Estimate).`}
        sources={[{ url: "https://example.com/pricing", title: "Example pricing" }]}
        simulated={false}
      />,
    );
    expect(screen.getByRole("heading", { name: "Refill pricing: three rivals" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    expect(container.querySelector(`[data-entity-id="${AGENT}"]`)?.textContent).toContain("Ada");
    const source = screen.getByRole("link", { name: /Example pricing/ });
    expect(source.getAttribute("href")).toBe("https://example.com/pricing");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByText(TASK_RESULT_SIMULATED)).toBeNull();
  });

  it("never renders the agent's HTML, images or links into the app; a source that is not http(s) is text", async () => {
    const { container } = render(
      <TaskResult
        title="<b>Bold</b> title"
        bodyMd={'Text <script>window.x=1</script><img src="https://stranger.example/p.png" onerror="alert(1)"> ![pixel](https://stranger.example/q.png) [settings](/b/x/settings) [js](javascript:alert(1))'}
        sources={[{ url: "javascript:alert(1)", title: "Bad source" }]}
        simulated={false}
      />,
    );
    await waitFor(() => expect(container.querySelector("[data-markdown] p:not(.whitespace-pre-wrap)")).not.toBeNull());
    expect(container.querySelector("script, img, b")).toBeNull();
    expect(screen.getByRole("heading", { name: "<b>Bold</b> title" })).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByText("Bad source").closest("a")).toBeNull();
  });

  it("says a simulated result is simulated, above the body", () => {
    const { container } = render(<TaskResult title="Rival scan" bodyMd="Three rivals." sources={[]} simulated />);
    const notice = screen.getByText(TASK_RESULT_SIMULATED);
    const body = container.querySelector("[data-markdown]")!;
    expect(notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-task-result]")?.getAttribute("data-simulated")).toBe("true");
  });
});
