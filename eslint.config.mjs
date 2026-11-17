// Flat ESLint config for the whole monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/** fm/no-raw-db: raw Drizzle query-builder calls on `db`/`tx` are only allowed inside packages/db repos, migrations, seeds, tests and the events outbox. */
const noRawDb = {
  meta: {
    type: "problem",
    docs: { description: "Raw db/tx query calls are only allowed in packages/db/src/repos (BUILD §7.1)." },
    messages: {
      raw: "Raw `{{name}}` outside packages/db/src/repos. Use a repository function that takes businessId as its first argument.",
    },
    schema: [],
  },
  create(context) {
    const filename = String(context.filename ?? context.getFilename());
    const allowed =
      /packages\/db\/(src\/(repos|seed|seeds|migrate|testing|schema)|migrations)\//.test(filename) ||
      /packages\/events\/src\/(outbox|relay|consume)/.test(filename) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename) ||
      /\/__tests__\//.test(filename) ||
      /\/scripts\//.test(filename);
    if (allowed) return {};
    const QUERY = new Set(["select", "insert", "update", "delete", "execute", "selectDistinct"]);
    const DB_NAMES = /^(db|tx|database|serviceDb|rlsDb)$/;
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        const prop = callee.property;
        const name = prop && prop.type === "Identifier" ? prop.name : null;
        if (!name || !QUERY.has(name)) return;
        const obj = callee.object;
        const objName =
          obj.type === "Identifier"
            ? obj.name
            : obj.type === "MemberExpression" && obj.property.type === "Identifier"
              ? obj.property.name
              : null;
        if (objName && DB_NAMES.test(objName)) {
          context.report({ node, messageId: "raw", data: { name: `${objName}.${name}()` } });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/storybook-static/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/.turbo/**",
      "**/migrations/**",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { fm: { rules: { "no-raw-db": noRawDb } }, "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    rules: {
      "fm/no-raw-db": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Accessibility of JSX (WP-10 T7): the plugin's recommended rules on every component file. A rule that fires on a
  // Radix pattern is turned off below for that rule, with its reason, never per file.
  { files: ["**/*.tsx"], ignores: ["**/*.test.tsx"], ...jsxA11y.flatConfigs.recommended },
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    rules: {
      // Dialogs and one-question steps put focus on their first field, as Radix Dialog does on open.
      "jsx-a11y/no-autofocus": "off",
      // A scrollable region takes tabIndex 0 so a keyboard can scroll it (axe scrollable-region-focusable).
      "jsx-a11y/no-noninteractive-tabindex": "off",
      // Roving-tabindex composites (tablist, radiogroup, menu, grid): the container takes the arrow keys, the items focus.
      "jsx-a11y/interactive-supports-focus": "off",
      // A <ul role="list"> keeps its list semantics in Safari, which drops them under list-style: none.
      "jsx-a11y/no-redundant-roles": "off",
      // A preview of the founder's own upload: there is no caption file to attach.
      "jsx-a11y/media-has-caption": "off",
      // Radix controls render a <button> inside the <label>; name them so the label counts as associated.
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Switch", "Checkbox", "Input", "Textarea", "RadioGroupItem"], depth: 3 }],
      // A pointer convenience on a card or row whose real control is inside it: reported, reviewed case by case.
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
    },
  },
);
