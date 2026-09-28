# Menote 单一实例机密（删除 BACKUP_CRED_KEY）· 实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 已完成（已实施并归档；代码提交 `df0e553`，见 §七 实施结果） |
| 目的和适用范围 | 把实例机密从**两个**（`AUTH_PEPPER`、`BACKUP_CRED_KEY`）收敛成**一个**：只配 `AUTH_PEPPER`，备份包裹键从它**域分离派生**。本文定设计、涉及文件、用例改动、兼容性与风险、验收点 |
| 权威级别 | 历史参考（临时规则，任务已完成） |
| 最后更新日期 | 2026-09-28 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.1 | v0.5.14 | 2026-09-28 | 收官：代码 / 用例 / 配置 / 文档全部落地（代码 `df0e553`），补 §七 实施结果与验证数字；`wiki/` 回写**仍待用户点头** | deepseek-v4.1-flash |
| v1 | v0.5.14 | 2026-09-28 | 首版：用户选定"彻底删除"，定设计（域分离派生）、涉及文件、兼容性与风险、验收点、时机 | deepseek-v4.1-flash |

## 一、为什么做 / 用户口径

用户 2026-09-28：**"只希望设置一个值，其他需要类似 key 的位置共用这一个即可"**；在三个选项里选了**彻底删除 `BACKUP_CRED_KEY`**（不是"填同一个值"，也不是"保留环境变量但可选"）。动机是自托管的配置负担：部署时只该填一次机密。

## 二、设计

**唯一根机密**：`AUTH_PEPPER`（名字不变——改名会让所有已部署实例的机密失效、全员登不进去）。

三处用途**各自域分离派生**，互不可推：

| 用途 | 现有做法 | 改后 |
|---|---|---|
| 登录校验（auth verifier） | `HMAC(AUTH_PEPPER, 浏览器派生的登录密钥)` | **不变** |
| 备份包裹键（`k_wrapped_backup`，服务端包/解 K） | `SHA-256(BACKUP_CRED_KEY 字节)` | `SHA-256(AUTH_PEPPER 字节 \|\| "menote-backup-wrap-v1")` |
| 分享令牌签名（M5，尚未实现） | 由 `AUTH_PEPPER` 派生（wiki §13.2） | 不变；实施时同样带自己的用途后缀 |

派生常量与函数放 **`packages/shared/src/crypto.ts`**（与 `BACKUP_CRED_KEY_SECRET` 同一处；该常量删除），带版本后缀便于将来换算法。

## 三、涉及文件（预计）

| 文件 | 改动 |
|---|---|
| `packages/shared/src/crypto.ts` | 删 `BACKUP_CRED_KEY_SECRET`；新增 `BACKUP_WRAP_CONTEXT = "menote-backup-wrap-v1"` 与派生函数（纯函数，带单测） |
| `apps/worker/src/services/crypto.ts` | 两处读 `env[BACKUP_CRED_KEY_SECRET]`（约 L127 启用、L245 重置）改成用派生键；**"缺机密"分支与 503 文案删除**（不再有这种状态） |
| `apps/worker/src/types.ts` | 删 `BACKUP_CRED_KEY?: string` 绑定 |
| `apps/worker/src/middleware/config-guard.ts` | 若它也列了这个机密就删（核对后定） |
| `apps/worker/vitest.config.ts` | 删测试绑定 `BACKUP_CRED_KEY`；补"只有 `AUTH_PEPPER` 也能启用"的用例 |
| `apps/worker/test/crypto.test.ts` | 用 `AUTH_PEPPER` 派生键的路径重写；**删掉/改写"缺 BACKUP_CRED_KEY 时 503"那条**（该状态不存在了） |
| `.dev.vars.example` | 删 `BACKUP_CRED_KEY` 段，写明"备份包裹键由 `AUTH_PEPPER` 派生，无需另配" |
| `README.md` | 部署清单回到"只需一个 `AUTH_PEPPER`"；删两条机密的说明与"省事做法"那段 |
| `CHANGELOG.md` / `package.json` | +0.0.1 条目 |
| `wiki/Menote-项目架构-v1.md`（§7.2 / §12.4 / §13.2 / §15.5）、`wiki/Menote-设计文档-v7.4.md`（§6.2） | **需要用户同意**后回写为"单一根机密 + 域分离派生" |

## 四、兼容性与风险（**必须先看**）

1. **已用真实 `BACKUP_CRED_KEY` 启用过隐私锁的实例**：它们库里的 `k_wrapped_backup` 是用那个机密包的，升级后**解不开**——"忘记隐私密码 → 重置"会失败（错误信息已明确写"可能已更换"）；**登录、解锁、改密不受影响**（改密时旧包裹原样带回，锁照常用）。
   - **已知受影响面**：我们这台实例**从未成功启用过**（就是被 503 挡住的那次），所以**风险为零**；README 的"Deploy to Cloudflare"按钮理论上可能产生第三方实例，若将来确认有，再补一层"临时读一次旧机密"的兼容（不写进本轮）。
   - **补救路径**（写给将来真踩到的人）：在**解锁态**重走一次加密设置以重包 K；但现有代码的"重包"只发生在**首次启用**，所以真要兜底得另加一个"重新包裹"入口——**本轮不做**，登记在案。
2. **轮换耦合**：换 `AUTH_PEPPER` 会同时影响登录校验与备份包裹。用户已接受（他本来就只要一个值）。
3. **安全边界**：域分离保证**从派生键推不出 `AUTH_PEPPER`**；且本项目内容在 D1 里本就是明文（隐私锁是前端门禁 + 备份加密），共用根机密不改变保护边界。**不得**把派生写成"直接复用同一个字节串当两把钥匙"——那样两处用途的密钥完全等同，失去域分离。
4. **`config-guard` 语义变化**：启用隐私锁不再有"缺机密"这一失败模式，相关用例与文案一起删；**不要**留下"永远不会触发的 503 分支"。

## 五、验收点

1. `.dev.vars` **只有** `AUTH_PEPPER` 时，本地"启用隐私锁 → 锁定 → 解锁 → 改密 → 重置"五条流程全部可用；
2. worker 用例：启用时 `k_wrapped_backup` 由派生键包出、重置时能解开；**不存在**"缺 BACKUP_CRED_KEY"用例；
3. 全仓 grep `BACKUP_CRED_KEY` **只剩文档（wiki 待回写、CHANGELOG 历史条目）**，代码与配置里为 0；
4. `pnpm lint` / `typecheck` / 全量测试全绿；README 的部署清单只需一个机密；
5. 回写 `wiki/` 后架构文档不再出现"两个机密"的表述（**需用户同意**）。

## 六、时机

排在 **B2（笔记本分组 + 树设置）→ B3（已收口）→ B4（设置页 11 分类重构）** 之后，作为独立小批做（改动集中在 worker 加密服务 + 三个用例 + 文档，与那两批不撞文件）。

## 七、实施结果（2026-09-28）

**代码提交 `df0e553`**（+ 文档提交），逐条对 §五 验收点：

| # | 验收点 | 结果 |
|---|---|---|
| 1 | 只有 `AUTH_PEPPER` 时启用 / 重置可用 | ✅ worker 用例「只配一个根机密：只有 AUTH_PEPPER 时，启用能包出备份包裹、重置能解出 K」端到端跑通（`putCryptoMaterials` + `resetContentKey`）；本地 `.dev.vars` 也已删掉那行，只剩 `AUTH_PEPPER` |
| 2 | 不存在"缺 BACKUP_CRED_KEY"用例 | ✅ 那条改成两条更贴事实的：只有根机密时可用；**缺 `AUTH_PEPPER`** 时包/解都明确报错（`requirePepper`，不拿空串派生）、读取端点照常 |
| 3 | 代码与配置里 grep 为 0 | ✅ **功能性引用为 0**（无 `env[...]` 读取、无绑定、无测试绑定）。**剩余 5 处是 `apps/web/**` 里的过时注释**（`usePrivacyLock.ts` 4 处、`endpoints.ts` 1 处）——本轮被"不要动任何 `apps/web/**`"这条硬约束挡住，**留给后续一批顺手改**（纯注释，无行为影响） |
| 4 | 全绿 + README 只需一个机密 | ✅ lint 0 / typecheck 0 / 全量 **1222**（shared 65（+3 域分离用例）/ mdcore 65 / web 883 / worker 209（+1））；`.dev.vars.example` 与 README 的部署清单都回到"只配一个"，并说明老部署上留着的 `BACKUP_CRED_KEY` 可以直接删 |
| 5 | `wiki/` 回写 | ⏳ **待用户点头**（见 §八） |

### 与计划的差异（如实记录）

1. **多了一个 `requirePepper` 分支**：计划里写的是"缺机密分支与文案一起删"。实际保留了一个**缺 `AUTH_PEPPER`** 的明确报错——因为用空串派生出来的包裹键谁都能复算，属"静默降级成不安全实现"，与 `config-guard` 的既有原则相悖。**删掉的是 `BACKUP_CRED_KEY` 那一支**。
2. **派生输入函数放 shared、SHA-256 留在 worker**：计划原文是"派生常量与函数落 shared"。实际 shared 只给 `backupWrapKeyInput` / `derivedKeyInput`（纯字符串／字节），摘要与 `importKey` 仍在 worker 的 `services/crypto.ts` 一处——因为 shared 的文件头明确写着"不做加密与派生"。因此 shared 的单测只能钉住"派生输入"这一层（同输入稳定 / 不同用途不同 / 不等于根机密本身）；**"包得进、解得开"由 worker 的端到端用例覆盖**。
3. **`AUTH_PEPPER` 的派生入口做了通用化**：多暴露一个 `derivedKeyInput(secret, context)`，让"域分离"可被直接断言，也给将来第二个用途（分享令牌签名）一个入口，避免各处手拼字符串。

## 八、待办（需要用户点头）

`wiki/` 里"两个机密"的表述共 **5 处**（架构 `§7.2` / `§12.4` / `§13.2` / `§15.5`，设计文档 `§6.2`，以及 `wiki/guides/local-dev.md` 的首部署清单），
需回写成"单一根机密 `AUTH_PEPPER` + 域分离派生"。`wiki/` 是定稿，按仓库规矩必须用户同意后才动。
另有 `docs/modules/Menote-认证与会话设计-v1.md` §6 的表格里"`BACKUP_CRED_KEY` ⏳ M5"一行同样过时（`docs/` 可直接改，随回写一起）。
