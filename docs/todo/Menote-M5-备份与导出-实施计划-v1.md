# Menote M5 备份与导出 实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 生效（执行中） |
| 目的和适用范围 | 把 `docs/modules/Menote-M5-备份与导出-设计-v1.md` 的格式契约落成代码。**本计划只覆盖格式层（第一批）**，导出/导入的编排与界面留到后续批次 |
| 权威级别 | 临时规则（实施计划） |
| 最后更新日期 | 2026-10-01 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.8 | 2026-10-01 | 初版：拆成格式层 / 编排层 / 界面层三批 | MiniMax-M3.1-Flash-Preview |

---

## 一、分批

| 批 | 做什么 | 涉及文件 | 本批验收 |
|---|---|---|---|
| **1（本批）** | 格式契约的**纯函数**：`manifest` / `COMPLETE` 的 schema 与编解码、路径归一化与穿越拒绝、哈希比对 | `packages/shared/src/backup.ts`（新增）、`packages/shared/test/backup.test.ts`（新增） | 纯函数全绿；不含任何浏览器/Worker 依赖 |
| 2 | 导出编排：读 IndexedDB、取草稿优先、下载附件、算哈希、可见进度与可中断 | `apps/web/src/features/backup/`（新增） | 能在本地导出一个通过校验的 zip |
| 3 | 导入编排：`COMPLETE` 校验 → 逐文件校验 → 复用 `createLocalItem` + outbox → 冲突三档 | `apps/web/src/features/backup/` | **同一份备份连导两次，条目数不变**（设计 §八-1 的开坑用例） |
| 4 | 界面：设置页新开「备份与导出」一档；恢复流程走多步危险流程规范 | `router.ts`、`SettingsPanel.tsx`、`app.css` | 按 `DESIGN.md` §5.1-2 画稿后再实现 |

## 二、本批明确不做

- 不写 zip 的打包/解包（那是第 2/3 批，且要选库——**选库属于加生产依赖，需用户点头**）
- 不动 `apps/worker`：第 3 批已验证不需要新协议，服务端零改动
- 不建 `packages/crypto-format`（见设计 §七）
- 不动 `wiki/`

## 三、本批的坑（先想清楚再写）

1. **`COMPLETE` 的哈希是对 `manifest.json` 字节算的**，不是对 JSON 重新序列化后算的。必须以"读到的原始字节"为准，否则换行/缩进差异会让校验假失败。
2. **路径归一化必须在校验之前**，且校验失败要**抛**而不是静默跳过——备份是用户唯一的救命资产，宁可整包拒收也不能读一半。
3. **schema 用 valibot**（`packages/shared` 已有依赖），与 `items.ts` / `sync.ts` 同一套，不要另引校验库。
4. 时间戳一律 **UTC ISO 字符串**，与库里 `created_at` / `updated_at` 的毫秒数在边界处显式转换，别混着存。

## 四、验收点

1. `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。
2. 新增用例覆盖：合法 `COMPLETE` 解析、哈希不匹配拒收、缺 `COMPLETE` 拒收、`../` 与绝对路径与盘符路径全部拒收、坏 manifest 拒收、条目索引路径指向不存在的文件时报错而非静默。
3. `packages/shared` 用例数不低于改前。
4. **未验证**：真实 zip 的端到端往返（第 2/3 批才有 zip 实现）。
