// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreLinks } from "@foundmill/config/app-links";

let links: StoreLinks | null = null;
vi.mock("@/lib/env", () => ({ publicEnv: () => ({ storeLinks: links }) }));

import { PublicAppPrompt } from "../PublicAppPrompt";

const BOTH: StoreLinks = { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=com.foundmill.app" };
const widthIs = (w: number) => Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
const before = window.innerWidth;

beforeEach(() => {
  links = null;
  widthIs(390);
});
afterEach(() => {
  cleanup();
  widthIs(before);
});

describe("PublicAppPrompt", () => {
  it("renders nothing while the store links are unset", () => {
    const { container } = render(<PublicAppPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing on a desktop window", () => {
    links = BOTH;
    widthIs(1280);
    const { container } = render(<PublicAppPrompt />);
    expect(container.querySelector("[data-get-the-app]")).toBeNull();
  });

  it("with links set on a phone, shows the store links and says nothing about people", () => {
    links = BOTH;
    const { container } = render(<PublicAppPrompt />);
    const stores = [...container.querySelectorAll("a[data-store]")].map((a) => a.getAttribute("data-store"));
    expect(stores).toEqual(["ios", "android"]);
    expect(container.textContent ?? "").not.toMatch(/co-?founder|collaborator|invite|people/i);
  });
});
