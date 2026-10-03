/**
 * 创建令牌弹窗（M6 批 4；界面稿 §四；功能拆解 M17-01）。
 *
 * **两个态原地切换**：填写态 → 已创建态。创建成功后**完整令牌只在这一刻出现一次**，
 * 关闭即丢弃、**不落任何本地存储**（缓存下来就等于在本地留一份凭据，刷新还在）。
 *
 * ## 几条照 DESIGN.md 落的口径
 *
 * - **只读不是一个可勾选项**（§5.3 的开关组 / §6.1 的禁用要说明）：它恒含，
 *   写成一行可见文字 + 常开的勾选图形，而不是一个置灰的开关——置灰还得解释为什么。
 * - **「允许通过 URL 使用」勾选时风险说明必须平铺**（§5.4-2：警告不得藏进 InfoHint）。
 * - **提交不禁用**，校验没过就地报错（§6.1：禁用必须说明为何，而这里就地报错更省事）。
 * - **零新增 CSS**：全部用既有 `field` / `setrow` / `segmented` / `toggle` / `hint-line`。
 */
import { useState } from "react";
import {
  MCP_PERM_CREATE,
  MCP_PERM_EDIT,
  MCP_PERM_LABELS,
  MCP_PERM_TRASH,
  type McpTokenCreated,
  type CreateMcpTokenRequest,
} from "@menote/shared";
import { Button, Field } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import { pushToast } from "../../../app/ui/Toast";
import type { LocalFolder } from "../../../data/db/schema";
import {
  MCP_EXPIRY_CHOICES,
  customDateMissing,
  expiryPayload,
  scopeCandidates,
  type McpExpiryChoice,
} from "../model";

export interface CreateTokenDialogProps {
  open: boolean;
  /** 范围候选（只列顶层；勾选自动含子文件夹） */
  folders: readonly LocalFolder[];
  onClose: () => void;
  /** 创建成功：把完整令牌交给页面，让它刷新列表 */
  onCreated: (created: McpTokenCreated) => void;
  create: (input: CreateMcpTokenRequest) => Promise<McpTokenCreated>;
}

type ScopeMode = "all" | "folders";

export function CreateTokenDialog({ open, folders, onClose, onCreated, create }: CreateTokenDialogProps) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<number>(0);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [pickedFolders, setPickedFolders] = useState<string[]>([]);
  // 这三列在契约里是 0 / 1，不是布尔：服务端用 FlagSchema 收，写 true 会被 422
  const [includeMemos, setIncludeMemos] = useState<0 | 1>(0);
  const [expiryChoice, setExpiryChoice] = useState<McpExpiryChoice>("30d");
  const [customDate, setCustomDate] = useState("");
  const [allowUrl, setAllowUrl] = useState<0 | 1>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const candidates = scopeCandidates(folders);

  /*
    状态**随挂载初始化**，不用 effect 重置——上一次填了一半的表单不该留在下一个令牌上，
    而「重置」这件事靠调用方给 `key`（`creating ? "open" : "closed"`）重挂载本组件来做。
    在 effect 里同步 setState 会引发级联重渲染（React 19 的 lint 明确禁止），而重挂载更干净：
    一次挂载 = 一次干净表单，没有"关掉再打开的中间态"。
  */

  async function submit(): Promise<void> {
    if (name.trim() === "") {
      setError("名称必填");
      return;
    }
    if (scopeMode === "folders" && pickedFolders.length === 0) {
      setError("请至少选一个文件夹，或改回「全部内容」");
      return;
    }
    if (customDateMissing(expiryChoice, customDate)) {
      setError("请选择自定义的过期日期");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await create({
        name: name.trim(),
        perms,
        folder_scope: scopeMode === "folders" ? pickedFolders : null,
        include_memos: includeMemos,
        allow_url: allowUrl,
        expires_in: expiryPayload(expiryChoice, customDate),
      });
      setCreated(result.secret);
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function copy(): void {
    if (created === null) return;
    void navigator.clipboard
      .writeText(created)
      .then(() => pushToast("令牌已复制", "success"))
      // 剪贴板在非 https 下会失败，**兜底也要给得出来**（同 MySharesPage）
      .catch(() => pushToast(created, "info", { label: "复制失败，请手动复制", onClick: () => undefined }));
  }

  if (created !== null) {
    return (
      <Modal
        open={open}
        title="令牌已创建"
        onClose={onClose}
        // 已创建态**不允许点遮罩关闭**：完整令牌只在这一刻可见，一点外面就永远看不到了
        dismissable={false}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              我已保存
            </Button>
            <Button variant="primary" size="sm" onClick={copy}>
              复制令牌
            </Button>
          </>
        }
      >
        <label className="field">
          <span>完整令牌</span>
          <input readOnly value={created} onFocus={(event) => event.target.select()} aria-label="完整令牌" />
        </label>
        {/* 「只显示一次」的后果必须平铺可见（DESIGN.md §5.4-2） */}
        <p className="hint-line">
          这是唯一一次显示完整令牌。关闭后无法再查看，之后只能看到前缀。
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="创建令牌"
      onClose={onClose}
      // 填了一半时点外面就丢了，所以不让遮罩随手关掉（DESIGN.md §6.4 的例外）
      dismissable={false}
      footer={
        <>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            创建
          </Button>
        </>
      }
    >
      {error !== null ? (
        <div role="alert" className="hint-line">
          <span>{error}</span>
        </div>
      ) : null}

      <Field
        label="名称"
        value={name}
        maxLength={64}
        placeholder="如：公司电脑的 Cursor"
        onChange={(event) => setName(event.target.value)}
      />

      {/*
        只读恒含：不用置灰开关。置灰要解释「为什么不能关」（DESIGN.md §6.1），
        而它压根不是一个选项——写成一行可见文字。
      */}
      <div className="field">
        <span>
          权限
          <InfoHint label="权限说明">
            只读之外的三个级别互相独立。比如只勾「新建和追加」，那个 agent
            就能往 Menote 里记东西，但改不了、也删不掉已有的条目。永久删除不开放。
          </InfoHint>
        </span>
        <p className="hint-line">✓ 只读（始终包含）</p>
        {(
          [MCP_PERM_CREATE, MCP_PERM_EDIT, MCP_PERM_TRASH] as const
        ).map((bit) => (
          <div key={bit} className="setrow">
            <div className="setrow__label">
              <span>{MCP_PERM_LABELS[bit]}</span>
            </div>
            <div className="setrow__control">
              <button
                type="button"
                role="switch"
                className="toggle"
                aria-checked={(perms & bit) === bit}
                aria-label={`授予「${MCP_PERM_LABELS[bit]}」权限`}
                onClick={() => setPerms((current) => (current & bit) === bit ? current & ~bit : current | bit)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="field">
        <span>范围</span>
        <SegmentedControl
          ariaLabel="令牌范围"
          value={scopeMode}
          options={[
            { value: "all", label: "全部内容" },
            { value: "folders", label: "指定文件夹" },
          ]}
          onChange={(value) => setScopeMode(value as ScopeMode)}
        />
      </div>

      {scopeMode === "folders" ? (
        <div className="field">
          <span>文件夹（勾一个就含它下面的所有子文件夹）</span>
          {candidates.length === 0 ? (
            <p className="hint-line">还没有文件夹。先在笔记本里建一个，或改回「全部内容」。</p>
          ) : (
            candidates.map((candidate) => (
              <label key={candidate.id} className="setrow">
                <span className="setrow__label">
                  <input
                    type="checkbox"
                    checked={pickedFolders.includes(candidate.id)}
                    onChange={() =>
                      setPickedFolders((current) =>
                        current.includes(candidate.id)
                          ? current.filter((id) => id !== candidate.id)
                          : [...current, candidate.id],
                      )
                    }
                  />{" "}
                  {candidate.name}
                  {candidate.childCount > 0 ? `（${candidate.childCount}）` : ""}
                </span>
              </label>
            ))
          )}
        </div>
      ) : null}

      {/*
        「包含 Memo」独立于范围：Memo 不在文件夹树里（功能拆解 M17-01），
        所以限定文件夹也管不到它。默认不勾 = 不可见（M17-03）。
      */}
      <div className="setrow">
        <div className="setrow__label">
          <span>包含 Memo</span>
        </div>
        <div className="setrow__control">
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={includeMemos === 1}
            aria-label="允许这枚令牌读写 Memo"
            onClick={() => setIncludeMemos(includeMemos === 1 ? 0 : 1)}
          />
        </div>
      </div>

      <div className="field">
        <span>有效期</span>
        <SegmentedControl
          ariaLabel="有效期"
          value={expiryChoice}
          options={MCP_EXPIRY_CHOICES.map((choice) => ({ value: choice.id, label: choice.label }))}
          onChange={(value) => setExpiryChoice(value as McpExpiryChoice)}
        />
        {expiryChoice === "custom" ? (
          <input
            type="date"
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
            aria-label="自定义过期日期"
          />
        ) : null}
      </div>

      <div className="setrow">
        <div className="setrow__label">
          <span>允许通过 URL 使用</span>
        </div>
        <div className="setrow__control">
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={allowUrl === 1}
            aria-label="允许这枚令牌通过 URL 使用"
            onClick={() => setAllowUrl(allowUrl === 1 ? 0 : 1)}
          />
        </div>
      </div>

      {/* 勾了才出现，且必须平铺（DESIGN.md §5.4-2：警告不得藏进 InfoHint） */}
      {allowUrl === 1 ? (
        <p className="hint-line">
          令牌放进 URL 后会出现在各种日志里：Cloudflare 与 Workers 的请求日志、客户端自己的日志、
          代理服务器日志。URL 也容易被截图、粘进聊天或提交到代码仓库。
          <strong>建议这类令牌只给只读权限，并设较短的过期时间。</strong>
        </p>
      ) : null}
    </Modal>
  );
}
