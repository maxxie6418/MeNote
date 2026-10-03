/**
 * 设置 › MCP（M6 批 4；界面稿 §二、§三；功能拆解 M17-01 / M17-02）。
 *
 * 四个块里这一屏装三个：**地址 + 接入说明**、**令牌列表**（主操作「创建令牌」）、
 * 以及行内触发的**撤销二次确认**。创建与审计是两个弹窗，在 `ui/` 下各自成文件。
 *
 * ## 三条照 DESIGN.md 落的口径
 *
 * - **撤销走行内二次确认**（用户 2026-10-03 拍板，与 `MySharesPage` 同款）：行内确认时
 *   上下文就在眼前，不用在弹窗里重新描述是哪一枚令牌；后果**平铺**可见（§5.4-2）。
 * - **达上限时「创建令牌」置灰 + 旁注平铺原因**（§6.1：禁用必须说明为何，不可只置灰）。
 * - **读失败不写空态**（§6.1 / 与附件管理页同处理）：读不出来时"还没有令牌"是假的。
 *
 * **零新增 CSS**：全部用既有 `setcard` / `setrow` / `field` / `hint-line` / `empty` /
 * `sharelink` / `pill` / `toggle`。不碰 `DESIGN.md`、不碰全局样式。
 */
import { useCallback, useEffect, useState } from "react";
import { MCP_MAX_ACTIVE_TOKENS, type McpTokenRecord } from "@menote/shared";
import { Button, EmptyState, Pill } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { pushToast } from "../../../app/ui/Toast";
import { useTicker } from "../../../app/ui/useTicker";
import { mcpApi } from "../../../data/api/endpoints";
import { listLocalFolders, listLocalItems } from "../../../data/db/repository";
import type { LocalFolder } from "../../../data/db/schema";
import {
  activeTokenCount,
  buildMcpAddress,
  expirySummary,
  formatRelative,
  isTokenLimitReached,
  permissionSummary,
  scopeSummary,
  tokenLimitHint,
  tokenStatus,
} from "../model";
import { CreateTokenDialog } from "./CreateTokenDialog";
import { TokenAuditDialog } from "./TokenAuditDialog";

/** 接入说明（功能拆解 M17-01【补全】要求的"一段接入说明"） */
const SETUP_STEPS: readonly string[] = [
  "在 Cursor、Claude Code、Codex 等工具里添加一个「MCP」或「远程 MCP」服务器。",
  "地址填上面那一行；传输方式选 Streamable HTTP（默认就是它，不用改）。",
  "认证方式选 Bearer / 请求头，把令牌粘进去。",
  "保存后工具会拉一次工具清单（tools/list），能看到 11 个工具就说明接通了。",
];

export function McpSettingsPage() {
  const [tokens, setTokens] = useState<McpTokenRecord[] | null>(null);
  const [folders, setFolders] = useState<readonly LocalFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [auditing, setAuditing] = useState<McpTokenRecord | null>(null);

  const address = buildMcpAddress(window.location.origin);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { tokens: rows } = await mcpApi.list();
      setTokens(rows);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "令牌列表加载失败");
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void mcpApi
      .list()
      .then((response) => {
        if (alive) setTokens(response.tokens);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "令牌列表加载失败");
        setTokens([]);
      });
    // 范围候选要读本地文件夹表；读不到就让"指定文件夹"给空列表（用户改回"全部内容"即可）
    void listLocalFolders()
      .then((rows) => {
        if (alive) setFolders(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /*
    "现在"走 `useTicker`：令牌列表上有「最近使用 2 小时前」这类相对时间，
    不重渲染就永远停在打开那一刻算出来的值。它本来就是为"把相对时间显示出来"造的。
    `active` 只在列表有内容时开——空屏每秒重渲染没有意义。
  */
  const now = useTicker(tokens !== null && tokens.length > 0);

  const limited = tokens !== null && isTokenLimitReached(tokens);

  function copy(text: string, ok: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => pushToast(ok, "success"))
      .catch(() => pushToast(text, "info", { label: "复制失败，请手动复制", onClick: () => undefined }));
  }

  async function revoke(token: McpTokenRecord): Promise<void> {
    setBusy(true);
    try {
      await mcpApi.revoke(token.id);
      setPendingRevoke(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* —— 块 A：地址与接入说明 —— */}
      <section className="setcard" aria-label="MCP 地址">
        <h3 className="setcard__title">
          接入
          <InfoHint label="MCP 说明">
            地址是固定的，没有可配项；决定它能读到什么的是令牌。端点是无状态的
            Streamable HTTP（不支持 SSE 长连接）。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span>地址</span>
          </div>
          <div className="setrow__control">
            {/* 文字链接用链接样式，不用按钮冒充（DESIGN.md §5.3） */}
            <span className="sharelink">{address}</span>
            <Button variant="secondary" size="sm" onClick={() => copy(address, "地址已复制")}>
              复制
            </Button>
          </div>
        </div>

        <div className="setrow">
          <div className="setrow__control">
            <Button variant="secondary" size="sm" onClick={() => setSetupOpen(true)}>
              接入说明
            </Button>
          </div>
        </div>
      </section>

      {/* —— 块 B：令牌列表 —— */}
      <section className="setcard" aria-label="令牌">
        <h3 className="setcard__title">
          令牌
          {/* 实时计数必须可见（DESIGN.md §5.4-2） */}
          {tokens !== null ? (
            <span className="badge">
              {activeTokenCount(tokens)} / {MCP_MAX_ACTIVE_TOKENS}
            </span>
          ) : null}
        </h3>

        {error !== null ? (
          <div role="alert" className="hint-line">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="setrow">
          <div className="setrow__label">
            <span>创建一枚令牌，交给要读写 Menote 的工具</span>
          </div>
          <div className="setrow__control">
            <Button
              variant="primary"
              size="sm"
              disabled={limited}
              onClick={() => setCreating(true)}
            >
              创建令牌
            </Button>
          </div>
        </div>

        {/* 禁用原因平铺，不只置灰也不只靠悬停（DESIGN.md §6.1） */}
        {limited ? <p className="hint-line">{tokenLimitHint()}</p> : null}

        {tokens === null ? <p className="hint-line">正在读取…</p> : null}

        {/* 读失败时不写空态：那时候"还没有令牌"是假的 */}
        {tokens !== null && error === null && tokens.length === 0 ? (
          <EmptyState
            title="还没有令牌"
            hint="创建一枚，把它和上面的地址一起交给 Cursor、Claude Code 等工具，它们就能读写你的内容。令牌只读也能用，只是看不到加密空间里的内容。"
            action={
              <Button variant="primary" size="sm" disabled={limited} onClick={() => setCreating(true)}>
                创建令牌
              </Button>
            }
          />
        ) : null}

        {tokens !== null
          ? tokens.map((token) => {
              const status = tokenStatus(token);
              return (
                <div
                  key={token.id}
                  className="setcard"
                  /* 已撤销 / 已过期：降透明度但**仍可查审计**——审计是判断
                     "该不该撤销"和"撤销后有没有还在用"的依据，撤掉了就看不到了 */
                  style={token.status === "active" ? undefined : { opacity: 0.7 }}
                >
                  <div className="setrow">
                    <div className="setrow__label">
                      <strong>{token.name}</strong>
                    </div>
                    <div className="setrow__control">
                      <span className="badge">{token.token_prefix}</span>
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </div>
                  </div>

                  <p className="hint-line">
                    {permissionSummary(token.perms)} · {scopeSummary(token.folder_scope)}
                    {token.include_memos === 1 ? " · 含 Memo" : ""}
                    {token.allow_url === 1 ? " · 允许 URL 使用" : ""}
                  </p>
                  <p className="hint-line">
                    最近使用 {formatRelative(token.last_used_at, now, "还没用过")} ·{" "}
                    {expirySummary(token.expires_at, now)}
                  </p>

                  <div className="setrow">
                    <div className="setrow__control">
                      <Button variant="secondary" size="sm" onClick={() => setAuditing(token)}>
                        审计记录
                      </Button>
                      {/* 已撤销 / 已过期不再给「撤销」（没意义），但审计仍可看 */}
                      {token.status === "active" ? (
                        pendingRevoke === token.id ? (
                          <>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() => void revoke(token)}
                            >
                              确认撤销
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setPendingRevoke(null)}
                            >
                              取消
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPendingRevoke(token.id)}
                          >
                            撤销
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>

                  {/* 破坏性后果平铺可见（DESIGN.md §5.4-2），不藏进 InfoHint */}
                  {pendingRevoke === token.id ? (
                    <p className="hint-line">
                      撤销后这枚令牌立刻失效，还在用它的 agent 会开始报错。
                      <strong>无法恢复</strong>——需要重新建一枚。
                    </p>
                  ) : null}
                </div>
              );
            })
          : null}
      </section>

      {/* `key` 让每次打开都是一次干净挂载：表单状态随挂载初始化，不靠 effect 重置 */}
      <CreateTokenDialog
        key={creating ? "create-open" : "create-closed"}
        open={creating}
        folders={folders}
        onClose={() => setCreating(false)}
        onCreated={() => void refresh()}
        create={mcpApi.create}
      />

      <TokenAuditDialog
        key={auditing?.id ?? "audit-none"}
        token={auditing}
        onClose={() => setAuditing(null)}
        load={(options) => mcpApi.audit(auditing?.id ?? "", options)}
        resolveLabels={async (ids) => {
          // 标题解析失败不打断这一屏（弹窗里显示「已不存在的条目」）
          const rows = await listLocalItems();
          const map = new Map<string, string>();
          for (const row of rows) {
            if (ids.includes(row.id)) map.set(row.id, row.title ?? "Memo");
          }
          return map;
        }}
      />

      <Modal
        open={setupOpen}
        title="接入说明"
        onClose={() => setSetupOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSetupOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                copy(
                  JSON.stringify(
                    {
                      mcpServers: {
                        menote: { type: "http", url: address, headers: { Authorization: "Bearer mn_你的令牌" } },
                      },
                    },
                    null,
                    2,
                  ),
                  "配置示例已复制",
                )
              }
            >
              复制配置示例
            </Button>
          </>
        }
      >
        <p className="hint-line">把地址和令牌交给工具，四步：</p>
        {SETUP_STEPS.map((step, index) => (
          <p key={step} className="hint-line">
            {index + 1}. {step}
          </p>
        ))}
        <p className="hint-line">
          建议先建一枚<strong>只读</strong>的令牌试通，再决定要不要给写权限。
        </p>
      </Modal>
    </>
  );
}
