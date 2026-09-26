import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// 行数预算（架构 §2.3.1 / §2.3.3）。
// 注意 flat config 后条覆盖前条：全局 500 → 路由/服务 300 → 入口 100。
const globalMaxLines = ["error", { max: 500, skipBlankLines: true, skipComments: true }];
const domainMaxLines = ["warn", { max: 300, skipBlankLines: true, skipComments: true }];
const entryMaxLines = ["error", { max: 100, skipBlankLines: true, skipComments: true }];

const reactHooksRules =
  reactHooks.configs?.recommended?.rules ??
  reactHooks.configs?.["recommended-latest"]?.rules ??
  {};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      ".agents/**",
      ".workbuddy/**",
      "prototype/**",
      "docs/**",
      "wiki/**",
      "deliverables/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // CLI 脚本以 console 输出为职责，关闭 no-console
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: { "max-lines": globalMaxLines },
  },
  {
    files: ["apps/worker/src/{routes,services,db,jobs,adapters,middleware}/**/*.ts"],
    rules: { "max-lines": domainMaxLines },
  },
  {
    files: ["apps/worker/src/index.ts", "apps/web/src/main.tsx"],
    rules: { "max-lines": entryMaxLines },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooksRules,
  },
);
