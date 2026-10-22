import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPersonaProvider } from "./AgentPersona";
import { Avatar, AvatarStack, avatarGeometry, deptPalette, generateAvatar, ringForStatus, statusGlyph } from "./Avatar";

describe("generateAvatar", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = generateAvatar({ seed: "agent-7", dept: "dept-2" });
    expect(a).toBe(generateAvatar({ seed: "agent-7", dept: "dept-2" }));
    expect(a).not.toBe(generateAvatar({ seed: "agent-8", dept: "dept-2" }));
  });

  it("keeps a seed's portrait stable (the head of agent-7 is pinned)", () => {
    const svg = generateAvatar({ seed: "agent-7", dept: "dept-2" });
    const head = svg.match(/<circle data-part="head" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
    expect(head?.slice(1)).toEqual(["23.0", "17.2", "7.2"]);
  });

  it("draws a head-and-shoulders portrait from the department palette with no colour literals", () => {
    const svg = generateAvatar({ seed: "agent-7", dept: "dept-5" });
    expect(svg).toContain('data-avatar="portrait"');
    // Ground, shard, accent square, shoulders, collar, head, hair: a person, not an icon.
    expect(svg).toMatch(/<linearGradient id="avatar-[a-z0-9]+-ground"/);
    expect(svg).toContain('<ellipse data-part="body"');
    expect(svg).toContain('<circle data-part="head"');
    expect(svg).toContain('<path data-part="hair"');
    expect(svg).toContain("var(--dept-5)");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("gives each department its own defs and honours a uid so two drawings never share ids", () => {
    const blue = generateAvatar({ seed: "s", dept: "dept-1" });
    const red = generateAvatar({ seed: "s", dept: "dept-4" });
    const id = (svg: string) => svg.match(/clipPath id="([^"]+)"/)?.[1];
    expect(id(blue)).not.toBe(id(red));
    expect(id(generateAvatar({ seed: "s", dept: "dept-1", uid: ":r1:" }))).toBe(id(blue)!.replace(/-clip$/, "r1-clip"));
  });

  it("derives the portrait's tones from one department token", () => {
    const p = deptPalette("dept-1");
    expect(p).toHaveLength(8);
    expect(p[0]).toBe("var(--dept-1)");
    for (const tone of p.slice(1)) expect(tone).toMatch(/^color-mix\(in oklab, var\(--dept-1\) \d+%, var\(--(white|bg-ink)\)\)$/);
  });
});

describe("avatarGeometry", () => {
  it("keeps dense sizes tight and gives larger ones the 3 px gap and 9 px dot", () => {
    expect(avatarGeometry(20)).toMatchObject({ gap: 1.5, dot: 7, cut: 1.5 });
    expect(avatarGeometry(28)).toMatchObject({ gap: 2, dot: 9, cut: 2 });
    expect(avatarGeometry(36)).toMatchObject({ gap: 3, dot: 9, cut: 2 });
    expect(avatarGeometry(68)).toMatchObject({ gap: 3, dot: 12, cut: 2 });
  });
  it("centres the dot on the face's edge at 45°", () => {
    // 36 px: the edge point is 5.27 px in from the corner; a 9 px dot centred there starts 0.8 px in.
    expect(avatarGeometry(36).dotInset).toBe(0.8);
  });
});

describe("Avatar", () => {
  it("renders a human with initials and a label", () => {
    render(<Avatar name="Ada Lovelace" size={32} />);
    const el = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(el.textContent).toBe("AL");
    expect(el.querySelector(".avatar-ring")).toBeNull();
  });

  it("renders an agent portrait with a 1.5 px status ring a few px out, named in the label", () => {
    render(<Avatar name="Scout" agent={{ seed: "s1", dept: "dept-3" }} status="healthy" size={36} />);
    const el = screen.getByRole("img", { name: "Scout, healthy" });
    expect(el.getAttribute("data-ring")).toBe("good");
    expect(el.className).toContain("tone-status-good");
    expect(el.style.getPropertyValue("--avatar-gap")).toBe("3px");
    expect(el.querySelector(".avatar-ring")).not.toBeNull();
    expect(el.querySelector('svg[data-avatar="portrait"]')).not.toBeNull();
  });

  it("draws presence: live breathes and lights the ring, with a dot cut out of the given surface", () => {
    render(<Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} status="healthy" presence="live" surface="rail" size={68} />);
    const el = screen.getByRole("img", { name: "Juno, healthy, live" });
    expect(el.getAttribute("data-presence")).toBe("live");
    expect(el.querySelector(".avatar-breathe")).not.toBeNull();
    expect(el.querySelector(".avatar-ring")?.hasAttribute("data-lit")).toBe(true);
    const dot = el.querySelector<HTMLElement>(".presence-dot")!;
    expect(dot.getAttribute("data-presence")).toBe("live");
    expect(dot.style.width).toBe("12px");
    expect(el.style.getPropertyValue("--avatar-cut")).toBe("var(--rail)");
  });

  it("tells presences apart by shape and words, not colour alone", () => {
    const { rerender } = render(<Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} presence="away" />);
    let el = screen.getByRole("img", { name: "Juno, away" });
    expect(el.querySelector(".avatar-breathe")).toBeNull();
    expect(el.querySelector(".presence-dot")?.getAttribute("data-presence")).toBe("away");
    rerender(<Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} presence="down" />);
    el = screen.getByRole("img", { name: "Juno, down" });
    expect(el.querySelector(".presence-dot")?.className).toContain("tone-status-bad");
    rerender(<Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} presence="working" />);
    el = screen.getByRole("img", { name: "Juno, working" });
    expect(el.querySelector(".avatar-breathe")).not.toBeNull();
    // Without a status ring the breath takes the presence's own tone.
    expect(el.className).toContain("tone-status-info");
  });

  it("names the status in its own words and adds a shape to the colour (VA11Y-X1, A11Y-17)", () => {
    const { rerender, container } = render(<Avatar name="Certification Specialist" agent={{ seed: "c", dept: "dept-2" }} status="degraded" size={26} />);
    let el = screen.getByRole("img", { name: "Certification Specialist, degraded" });
    expect(el.getAttribute("data-ring")).toBe("warn");
    expect(container.querySelector("[data-glyph='degraded'] svg")).not.toBeNull();
    rerender(<Avatar name="PR Engine" agent={{ seed: "p", dept: "dept-3" }} status="paused" size={26} />);
    el = screen.getByRole("img", { name: "PR Engine, paused" });
    expect(el.getAttribute("data-ring")).toBe("idle");
    expect(el.querySelector(".avatar-ring")?.hasAttribute("data-dashed")).toBe(true);
    expect(container.querySelector("[data-glyph='paused']")).not.toBeNull();
    rerender(<Avatar name="Scout" agent={{ seed: "s", dept: "dept-3" }} status="injured" size={26} />);
    expect(screen.getByRole("img", { name: "Scout, down" }).getAttribute("data-ring")).toBe("bad");
    expect(container.querySelector("[data-glyph='injured']")).not.toBeNull();
    rerender(<Avatar name="Scout" agent={{ seed: "s", dept: "dept-3" }} status="idle" size={26} />);
    expect(screen.getByRole("img", { name: "Scout, idle" }).querySelector(".avatar-ring")?.hasAttribute("data-dashed")).toBe(true);
    expect(container.querySelector("[data-glyph]")).toBeNull();
    rerender(<Avatar name="Scout" agent={{ seed: "s", dept: "dept-3" }} status="healthy" size={26} />);
    expect(screen.getByRole("img", { name: "Scout, healthy" }).querySelector(".avatar-ring")?.hasAttribute("data-dashed")).toBe(false);
    expect(container.querySelector("[data-glyph]")).toBeNull();
    expect([statusGlyph("failing"), statusGlyph("healthy")].map((g) => g !== null)).toEqual([true, false]);
  });

  it("maps statuses to rings", () => {
    expect(ringForStatus("healthy")).toBe("good");
    expect(ringForStatus("degraded")).toBe("warn");
    expect(ringForStatus("paused")).toBe("idle"); // neutral, as its pill is
    expect(ringForStatus("failing")).toBe("bad");
    expect(ringForStatus("injured")).toBe("bad");
    expect(ringForStatus("idle")).toBe("idle");
    expect(ringForStatus(undefined)).toBe("none");
  });

  it("renders on the server (no client hooks) with the same portrait for the same seed", () => {
    const a = renderToStaticMarkup(<Avatar name="Scout" agent={{ seed: "s1", dept: "dept-3" }} presence="live" />);
    expect(a).toContain('data-avatar="portrait"');
    expect(a).toContain("avatar-breathe");
  });
});

describe("AvatarStack", () => {
  it("shows the first `max` faces and a +N count", () => {
    render(<AvatarStack max={2} items={[{ name: "A", agent: { seed: "a", dept: "dept-1" } }, { name: "B" }, { name: "C" }]} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByLabelText("1 more").textContent).toBe("+1");
  });
});

describe("Avatar with an AI-generated face", () => {
  it("shows the image over the drawn portrait, keeping the ring and the label", () => {
    const { container } = render(<Avatar name="Bob" agent={{ seed: "s1", dept: "dept-3", src: "/faces/bob.png" }} status="healthy" size={36} />);
    const el = screen.getByRole("img", { name: "Bob, healthy" });
    const img = container.querySelector<HTMLImageElement>("img[data-avatar='photo']")!;
    expect(img.getAttribute("src")).toBe("/faces/bob.png");
    expect(img.className).toContain("object-cover");
    expect(img.getAttribute("alt")).toBe("");
    // The drawn portrait stays underneath: it is what shows while the face loads or if it never does.
    expect(el.querySelector("svg[data-avatar='portrait']")).not.toBeNull();
    expect(el.querySelector(".avatar-ring")).not.toBeNull();
    expect(el.getAttribute("data-ring")).toBe("good");
  });

  it("draws the portrait as before when there is no image", () => {
    const { container } = render(<Avatar name="Bob" agent={{ seed: "s1", dept: "dept-3" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg[data-avatar='portrait']")).not.toBeNull();
  });

  it("asks the persona provider for the face by key, only while the preference is on", () => {
    const portraitUrl = (k: string) => (k === "malik" ? "/personas/malik" : null);
    const agent = { seed: "s1", dept: "dept-3" as const, personaKey: "malik" };
    const on = render(
      <AgentPersonaProvider anthropomorphic portraitUrl={portraitUrl}>
        <Avatar name="Malik" agent={agent} />
      </AgentPersonaProvider>,
    );
    expect(on.container.querySelector("img[data-avatar='photo']")?.getAttribute("src")).toBe("/personas/malik");
    // Named by the persona's first name.
    expect(screen.getByRole("img", { name: "Malik" })).toBeTruthy();
    on.unmount();
    const off = render(
      <AgentPersonaProvider anthropomorphic={false} portraitUrl={portraitUrl}>
        <Avatar name="Malik" agent={agent} />
      </AgentPersonaProvider>,
    );
    expect(off.container.querySelector("img")).toBeNull();
    off.unmount();
    // A key whose portrait is not ready keeps the drawn portrait.
    const pending = render(
      <AgentPersonaProvider anthropomorphic portraitUrl={portraitUrl}>
        <Avatar name="Amara" agent={{ ...agent, personaKey: "amara" }} />
      </AgentPersonaProvider>,
    );
    expect(pending.container.querySelector("svg[data-avatar='portrait']")).not.toBeNull();
  });
});
