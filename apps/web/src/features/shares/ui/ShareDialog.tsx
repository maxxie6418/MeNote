/**
 * 单篇的分享弹窗（M5-S2；《M5 分享设计》§四-S2）。
 *
 * 一个弹窗两态：
 * - **这篇还没有分享** → 创建表单（可选密码 + 过期档位），创建成功就地显示链接与「复制」；
 * - **已有生效中的分享** → 逐条列出（链接 + 复制 + 撤销）。改密码 / 改过期在
 *   设置 › 分享（MySharesPage）做——弹窗保持"拿到链接"这个单一目的，不做第二套编辑面。
 *
 * 创建是**危险等级低**的动作（不覆盖任何内容），不设二次确认；撤销是破坏性的
 * （访客立即看不到），就地确认一次（DESIGN.md §5.1-2）。
 */
import { useCallback, useEffect, useState } from "react";
import type { ShareRecord } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { pushToast } from "../../../app/ui/Toast";
import { sharesApi } from "../../../data/api/endpoints";
import {
  SHARE_EXPIRY_CHOICES,
  buildShareLink,
  deriveSharePasswordMaterial,
  expiryTimestamp,
  type ShareExpiryChoice,
} from "../model";

export interface ShareDialogProps {
  item: { id: string; title: string | null };
  onClose: () => void;
}

export function ShareDialog({ item, onClose }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [password, setPassword] = useState("");
  const [expiry, setExpiry] = useState<ShareExpiryChoice>("7d");
  const [customDate, setCustomDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const load = useCallback(async (): Promise<ShareRecord[]> => {
    const { shares: all } = await sharesApi.list();
    return all.filter((share) => share.kind === "item" && share.item_id === item.id);
  }, [item.id]);

  const refresh = useCallback((): Promise<void> => {
    return load()
      .then((rows) => {
        setShares(rows);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "分享列表加载失败");
        setShares([]);
      });
  }, [load]);

  useEffect(() => {
    let alive = true;
    void load()
      .then((rows) => {
        if (alive) setShares(rows);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "分享列表加载失败");
          setShares([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [load]);

  async function create(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const expiresAt = expiryTimestamp(expiry, Date.now(), customDate);
      // 选了自定义却没给日期 → 过期时间为 null 等于「永不过期」，语义变了，这里拦下
      if (expiry === "custom" && expiresAt === null) {
        throw new Error("自定义过期需要先选一个日期");
      }
      await sharesApi.create({
        kind: "item",
        item_id: item.id,
        password: password.trim().length > 0 ? await deriveSharePasswordMaterial(password.trim()) : null,
        expires_at: expiresAt,
      });
      setPassword("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    try {
      await sharesApi.revoke(id);
      setPendingRevoke(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败，请稍后重试");
    }
  }

  function copyLink(share: ShareRecord): void {
    const link = buildShareLink(share.id, null);
    void navigator.clipboard
      .writeText(link)
      .then(() => pushToast("链接已复制", "success"))
      .catch(() =>
        pushToast(link, "info", { label: "复制失败，请手动复制", onClick: () => undefined }),
      );
  }

  const list = shares ?? [];

  return (
    <Modal open title={shares === null ? "分享" : list.length > 0 ? "分享（生效中）" : "创建分享链接"} onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
          {list.length === 0 && shares !== null ? (
            <Button variant="primary" size="sm" disabled={creating} onClick={() => void create()}>
              创建链接
            </Button>
          ) : null}
        </>
      }
    >
      {error !== null ? (
        <div role="alert" className="hint-line">
          <span>{error}</span>
        </div>
      ) : null}

      {shares === null ? <p className="hint-line">正在读取分享状态…</p> : null}

      {shares !== null && list.length > 0 ? (
        <>
          <p className="hint-line">这篇有 {list.length} 条生效中的分享链接。</p>
          {list.map((share) => (
            <div key={share.id} className="setrow">
              <div className="setrow__label">
                <span className="sharelink">{buildShareLink(share.id, null)}</span>
              </div>
              <div className="setrow__control">
                <Button variant="secondary" size="sm" onClick={() => copyLink(share)}>
                  复制
                </Button>
                {pendingRevoke === share.id ? (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void revoke(share.id);
                      }}
                    >
                      确认撤销
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setPendingRevoke(null)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setPendingRevoke(share.id)}>
                    撤销
                  </Button>
                )}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {shares !== null && list.length === 0 ? (
        <>
          <p className="hint-line">
            访客打开链接能看这一篇的只读内容；他们看不到你的其他任何内容。
            <InfoHint label="分享说明">
              设了密码的链接要先输密码；过期、撤销或这一篇被删除、加密后，链接立即失效。
            </InfoHint>
          </p>

          <label className="field">
            <span>访问密码（可选）</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="留空 = 无需密码"
              autoComplete="new-password"
            />
          </label>

          <div className="field">
            <span>有效期</span>
            <div className="segmented" role="group" aria-label="有效期">
              {SHARE_EXPIRY_CHOICES.filter((choice) => choice.id !== "custom").map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="segmented__item"
                  aria-pressed={expiry === choice.id}
                  onClick={() => setExpiry(choice.id)}
                >
                  {choice.label}
                </button>
              ))}
              <button
                type="button"
                className="segmented__item"
                aria-pressed={expiry === "custom"}
                onClick={() => setExpiry("custom")}
              >
                自定义
              </button>
            </div>
            {expiry === "custom" ? (
              <input
                type="date"
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                aria-label="过期日期"
              />
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
