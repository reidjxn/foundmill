// Flat ESLint config for the whole monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
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
);
