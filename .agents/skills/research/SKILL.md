---
name: research
description: 以高可信度的一手资料为基准调研某个问题，并把结论沉淀为仓库中的 Markdown 文件。当用户想调研某个主题、收集文档或 API 事实，或把查阅资料的活儿交给后台代理时使用。
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
