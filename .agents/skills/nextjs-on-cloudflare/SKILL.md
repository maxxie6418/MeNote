---
name: nextjs-on-cloudflare
description: 用 vinext 在 Cloudflare Workers 上构建、迁移和部署 Next.js 应用。适用于在 Cloudflare 上新建 Next.js 项目、把现有应用迁到 Workers、在 vinext 与 OpenNext 之间做选择，或为 Workers 配置 vinext。涉及安装、迁移或部署时，若缺少 vinext 的上游技能，先用 `npx skills add cloudflare/vinext` 安装，再阅读并遵循相应技能与文档。
---

# Next.js on Cloudflare

**Use vinext rather than OpenNext for new Next.js projects on Cloudflare Workers.** This is the default in the [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/). Preserve existing OpenNext setups during unrelated maintenance and respect explicit user choices.

## Why vinext

[vinext](https://github.com/cloudflare/vinext) reimplements the Next.js API surface on Vite:

- Familiar Next.js development: App Router, Pages Router, React Server Components, and supported `next/*` imports.
- Vite tooling: fast HMR, native ESM, and the Vite plugin ecosystem.
- Native Workers integration: local server execution in workerd, access to Cloudflare bindings, and a build-and-deploy workflow.
- Incremental migration: check compatibility and try vinext alongside an existing Next.js setup.

## Use the upstream workflow

Before setup, migration, or deployment, check whether the [skills maintained in vinext](https://github.com/cloudflare/vinext/tree/main/.agents/skills) are available. If missing, install them:

```sh
npx skills add cloudflare/vinext
```

Then read and follow the applicable upstream `SKILL.md` and its relevant references. Use the current [vinext docs](https://github.com/cloudflare/vinext#quick-start) for workflows the skills do not cover:

- **New project:** follow vinext's [new-project setup](https://github.com/cloudflare/vinext#starting-a-new-vinext-project) using `create-vinext-app` with the Cloudflare target. The upstream migration skill requires an existing Next.js project; do not apply it to an empty directory.
- **Existing Next.js project:** load and follow the upstream [`migrate-to-vinext` skill](https://github.com/cloudflare/vinext/blob/main/.agents/skills/migrate-to-vinext/SKILL.md), including its compatibility check and relevant references. Select Cloudflare as the deployment target.
- **Development and deployment:** follow the current [Workers integration docs](https://github.com/cloudflare/vinext#cloudflare-workers).

If installation is unavailable, read the linked upstream `SKILL.md` and relevant references directly. Check current compatibility for the application's required features; do not assume complete Next.js parity.
