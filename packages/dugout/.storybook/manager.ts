import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

// Dark manager chrome so the stories and the frame agree (DESIGN §1: no light theme exists).
addons.setConfig({
  theme: create({
    base: "dark",
    brandTitle: "Foundmill design system",
    appBg: "#0f1318",
    appContentBg: "#171c23",
    appBorderColor: "#2a313b",
    barBg: "#171c23",
    textColor: "#e8ecf1",
    textMutedColor: "#9aa4b2",
    colorPrimary: "#7cc4ff",
    colorSecondary: "#2b6cb0",
    fontBase: '"Inter", system-ui, sans-serif',
    fontCode: '"JetBrains Mono", ui-monospace, monospace',
    appBorderRadius: 4,
    inputBg: "#1d232b",
    inputBorder: "#2a313b",
    inputTextColor: "#e8ecf1",
  }),
});
