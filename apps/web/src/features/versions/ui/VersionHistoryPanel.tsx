/**
 * 版本历史面板（M4-11；《M4 界面稿》§四）。
 *
 * **主操作区独立面板页**（不是弹窗）：界面稿 §4.1 明确理由是"弹窗最大宽 400px 装不下并排 diff"，
 * 而给 `DESIGN.md` 加"宽弹窗"档属于改视觉源——所以这里占满主操作区，靠「关闭」返回。
 *
 * 五个块：页头（标题 + 条目标题 + 关闭）→ 版本列表（时间/中文原因/大小/备注/保留标记/行菜单）
 * → 对比区（单看全文或两版 diff；未选中给空状态）→ 底部（唯一实心主按钮「存为版本」+ 关闭）。
 * 列表与对比区**各一个滚动容器**，不嵌套。
 */
import { useState } from "react";
import { Button, EmptyState, IconButton } from "../../../app/ui/Controls";
import { Chip } from "../../../app/ui/Chip";
import { Modal } from "../../../app/ui/Modal";
import { DropdownMenu } from "../../../app/ui/Menu";
import { VersionDiff } from "./VersionDiff";
import {
  RESTORE_NEEDS_SAVE_HINT,
  lineDiff,
  restoreConfirmText,
  type VersionRowModel,
} from "../model";

export interface VersionHistoryPanelProps {
  /** 当前条目标题（明文） */
  itemTitle: string;
  rows: readonly VersionRowModel[];
  loading?: boolean;
  /** 正在查看的版本全文（选一个版本时拉取） */
  bodyLoading?: boolean;
  /** 已拉到的版本正文（`versionId -> 正文`） */
  bodies: Readonly<Record<string, string>>;
  /** 与当前稿做对比时的当前稿正文 */
  currentBody: string;
  busy?: boolean;
  onClose: () => void;
  /** 存为版本（可填备注） */
  onSeal: (label: string | null) => Promise<void> | void;
  onRestore: (versionId: string) => Promise<void> | void;
  onToggleKeep: (versionId: string, keep: boolean) => Promise<void> | void;
  /** 选一个版本时让上层去拉正文 */
  onOpenVersion: (versionId: string) => void;
}

export function VersionHistoryPanel({
  itemTitle,
  rows,
  loading = false,
  bodyLoading = false,
  bodies,
  currentBody,
  busy = false,
  onClose,
  onSeal,
  onRestore,
  onToggleKeep,
  onOpenVersion,
}: VersionHistoryPanelProps) {
  /** 选中用于对比的版本（最多两个；点第一个看全文，点第二个进入 diff） */
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<VersionRowModel | null>(null);
  const [sealing, setSealing] = useState(false);
  const [label, setLabel] = useState("");

  const rowById = (id: string): VersionRowModel | undefined => rows.find((row) => row.id === id);
  const [first, second] = selected;

  return (
    <div className="versionpanel">
      <header className="versionpanel__head">
        <h1 className="versionpanel__title">版本历史</h1>
        <span className="versionpanel__sub">{itemTitle}</span>
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭
        </Button>
      </header>

      <div className="versionpanel__body">
        <div className="versionpanel__list" aria-label="版本列表">
          {loading ? (
            <div className="skeleton" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="还没有版本"
              hint="停止编辑一段时间会自动封存，也可以点下面的「存为版本」立即留一个。"
            />
          ) : (
            <ul className="versionlist">
              {rows.map((row) => (
                <li key={row.id} className="versionrow">
                  <button
                    type="button"
                    className="versionrow__pick"
                    aria-pressed={selected.includes(row.id)}
                    onClick={() => {
                      onOpenVersion(row.id);
                      setSelected((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id].slice(-2),
                      );
                    }}
                  >
                    <span className="versionrow__time">{row.timeLabel}</span>
                    <Chip variant="tag">{row.reasonLabel}</Chip>
                    <span className="versionrow__size">{row.sizeLabel}</span>
                    {row.label ? <span className="versionrow__label">{row.label}</span> : null}
                    {row.keep ? <Chip tone="amber">保留</Chip> : null}
                  </button>

                  <DropdownMenu
                    label={`${row.timeLabel} 的版本操作`}
                    showChevron={false}
                    trigger={<span className="versionrow__menu"><IconButton label="更多" icon="more" size={13} /></span>}
                    items={[
                      {
                        id: "view",
                        label: "查看全文",
                        onSelect: () => {
                          onOpenVersion(row.id);
                          setSelected([row.id]);
                        },
                      },
                      {
                        id: "diff-current",
                        label: "与当前稿对比",
                        onSelect: () => {
                          onOpenVersion(row.id);
                          setSelected([row.id, "current"]);
                        },
                      },
                      {
                        id: "restore",
                        label: "恢复此版本",
                        onSelect: () => setConfirming(row),
                      },
                      {
                        id: "keep",
                        label: row.keep ? "取消保留" : "标记为保留",
                        onSelect: () => void onToggleKeep(row.id, !row.keep),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="versionpanel__diff" aria-label="版本对比">
          {selected.length === 0 ? (
            <EmptyState
              title="选一个版本看全文，选两个（或与当前稿）看差异"
              hint="版本是只读快照；恢复会以它覆盖当前稿，并且先把当前稿也存成一个版本。"
            />
          ) : bodyLoading ? (
            <div className="skeleton" />
          ) : selected.length === 1 ? (
            <pre className="versionpanel__fulltext">{bodies[first ?? ""] ?? "（正文加载中）"}</pre>
          ) : (
            <VersionDiff
              leftTitle={second === "current" ? "此版本" : (rowById(first ?? "")?.timeLabel ?? "此版本")}
              rightTitle={second === "current" ? "当前稿" : (rowById(second ?? "")?.timeLabel ?? "")}
              result={lineDiff(
                bodies[first ?? ""] ?? "",
                second === "current" ? currentBody : (bodies[second ?? ""] ?? ""),
              )}
            />
          )}
        </div>
      </div>

      <footer className="versionpanel__foot">
        <span className="hint-line">{RESTORE_NEEDS_SAVE_HINT}</span>
        <Button variant="primary" size="sm" onClick={() => setSealing(true)} disabled={busy}>
          存为版本
        </Button>
      </footer>

      {/* 「存为版本」：备注可空（界面稿 §4.4） */}
      <Modal
        open={sealing}
        title="存为版本"
        desc="备注可留空；手动存的版本默认永久保留。"
        onClose={() => setSealing(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSealing(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const next = label.trim() === "" ? null : label.trim();
                setSealing(false);
                setLabel("");
                void onSeal(next);
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">备注（可空）</span>
          <input
            className="field__input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
      </Modal>

      {/* 恢复确认框：界面稿 §4.5 的三段必须全在 */}
      <Modal
        open={confirming !== null}
        title={confirming ? restoreConfirmText(confirming).title : "恢复此版本"}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target) void onRestore(target.id);
              }}
            >
              恢复此版本
            </Button>
          </>
        }
      >
        {(confirming ? restoreConfirmText(confirming).body : []).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </Modal>
    </div>
  );
}
