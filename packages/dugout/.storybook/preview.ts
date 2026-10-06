import type { Preview } from "@storybook/react-vite";
import "../src/fonts.css";
import "../src/dugout.css";

const preview: Preview = {
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
        order: ["Dugout", ["Welcome", "Tokens"], "Foundation"],
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "base" },
  },
  tags: ["autodocs"],
};

export default preview;
