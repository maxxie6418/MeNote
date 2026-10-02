/**
 * 设置 › 分享（M5-S2；功能拆解 M14-03「我的分享」）。
 *
 * 与条目侧弹窗（ShareDialog）同一份数据源：创建在条目侧（"分享这一篇"的动作语义），
 * 这里集中做**管理**——复制链接、改密码、改过期、撤销（M14-03 定稿的操作清单）。
 * 撤销是破坏性的，就地确认一次并写明后果（DESIGN.md §5.1-2）。
 */
import { useCallback, useEffect, useState } from "react";
import type { ShareRecord } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { pushToast } from "../../../app/ui/Toast";
import { sharesApi } from "../../../data/api/endpoints";
import {
  SHARE_EXPIRY_CHOICES,
  buildShareLink,
  deriveSharePasswordMaterial,
  expiryTimestamp,
  formatExpiry,
  type ShareExpiryChoice,
} from "../model";

export function MySharesPage() {
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editChoice, setEditChoice] = useState<ShareExpiryChoice>("7d");
  const [editDate, setEditDate] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<ShareRecord[]> => {
    const { shares: rows } = await sharesApi.list();
    return rows;
  }, []);

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

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
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

  return (
    <>
      <section className="setcard" aria-label="我的分享">
        <h3 className="setcard__title">
          我的分享
          <InfoHint label="我的分享说明">
            撤销立即生效；过期、条目删除或加密也会让链接失效。改密码不影响已拿到链接的人能否访问——他们仍需输入新密码。
          </InfoHint>
        </h3>

        {error !== null ? (
          <div role="alert" className="hint-line">
            <span>{error}</span>
          </div>
        ) : null}

        {shares === null ? <p className="hint-line">正在读取…</p> : null}
        {shares !== null && shares.length === 0 ? (
          <p className="hint-line">还没有分享。在笔记的「更多」菜单里选「分享」创建链接。</p>
        ) : null}

        {shares !== null
          ? shares.map((share) => (
              <div key={share.id} className="setcard">
                <p className="hint-line">
                  <strong>{share.item_title ?? "（无标题）"}</strong>
                  {share.has_password ? " · 有密码" : " · 无密码"} · {formatExpiry(share.expires_at)}
                </p>
                <div className="setrow">
                  <div className="setrow__label">
                    <span className="sharelink">{buildShareLink(share.id, null)}</span>
                  </div>
                  <div className="setrow__control">
                    <Button variant="secondary" size="sm" onClick={() => copyLink(share)}>
                      复制
                    </Button>
                  </div>
                </div>

                {editing === share.id ? (
                  <div className="setcard">
                    <div className="field">
                      <span>新的有效期</span>
                      <div className="segmented" role="group" aria-label="新的有效期">
                        {SHARE_EXPIRY_CHOICES.filter((choice) => choice.id !== "custom").map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            className="segmented__item"
                            aria-pressed={editChoice === choice.id}
                            onClick={() => setEditChoice(choice.id)}
                          >
                            {choice.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="segmented__item"
                          aria-pressed={editChoice === "custom"}
                          onClick={() => setEditChoice("custom")}
                        >
                          自定义
                        </button>
                      </div>
                      {editChoice === "custom" ? (
                        <input
                          type="date"
                          value={editDate}
                          onChange={(event) => setEditDate(event.target.value)}
                          aria-label="新的过期日期"
                        />
                      ) : null}
                    </div>
                    <label className="field">
                      <span>新密码（留空 = 改为无密码）</span>
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(event) => setEditPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <div className="setrow">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            const expiresAt = expiryTimestamp(editChoice, Date.now(), editDate);
                            await sharesApi.patch(share.id, {
                              expires_at: expiresAt,
                              password:
                                editPassword.trim().length > 0
                                  ? await deriveSharePasswordMaterial(editPassword.trim())
                                  : null,
                            });
                            setEditing(null);
                            setEditPassword("");
                          });
                        }}
                      >
                        保存修改
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="setrow">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(share.id)}>
                      改密码 / 改有效期
                    </Button>
                    {pendingRevoke === share.id ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              await sharesApi.revoke(share.id);
                              setPendingRevoke(null);
                            });
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
                )}
              </div>
            ))
          : null}
      </section>
    </>
  );
}
