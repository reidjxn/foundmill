import type { Decorator, Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { BuilderViewProvider } from "../src/components/guidance/BuilderView";
import "../src/fonts.css";
import "../src/dugout.css";

/**
 * Builder view (docs/DESIGN.md "Builder view"): the toolbar's "Builder view" toggle. On by default here, so every story
 * shows the engine as before; switch it off to see what a founder sees. A story can pin it with `globals.builderView`.
 */
const withBuilderView: Decorator = (Story, context) => createElement(BuilderViewProvider, { on: context.globals.builderView !== "off" }, createElement(Story));

const preview: Preview = {
  decorators: [withBuilderView],
  globalTypes: {
    builderView: {
      description: "Builder view: show how the platform runs the team (cycle numbers, tokens, technical columns)",
      toolbar: {
        title: "Builder view",
        icon: "wrench",
        items: [
          { value: "on", title: "Builder view on" },
          { value: "off", title: "Builder view off" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: "padded",
    backgrounds: {
      options: {
        base: { name: "Base", value: "var(--bg-base)" },
        panel: { name: "Panel", value: "var(--bg-panel)" },
        ink: { name: "Ink", value: "var(--bg-ink)" },
      },
    },
    a11y: {
      // WCAG 2.2 AA (BUILD §5.4). Colour-contrast is checked by axe against the resolved tokens.
      options: { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      test: "error",
    },
    docs: { toc: true },
    controls: { expanded: true },
    options: {
      storySort: {
        order: ["Design system", ["Welcome", "Tokens"], "Foundation"],
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "base" },
    builderView: "on",
  },
  tags: ["autodocs"],
};

export default preview;
