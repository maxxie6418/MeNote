/**
 * 回收站页（M4-12；《M4 界面稿》§六）。
 *
 * **独立页、不是功能栏入口**（功能拆解 Q2 已确认）：页头是「← 返回设置」+ 标题 + 保留期说明
 * + 右侧危险操作「清空回收站」；列表行给类型、标题、删除时间、**剩余保留天数（实时计数）**、
 * 行内「恢复」与「永久删除」；多选后出现批量条。
 *
 * 这个组件是**受控的**：数据与动作都由调用方给（`rows` / `onRestore` / `onPurge` / …），
 * 自己不碰 IndexedDB 与网络——于是它能在 jsdom 里被完整测，也便于先做界面再接数据。
 *
 * 三处按界面稿刻意做的：
 * 1. **本页没有实心主色按钮**（页头是危险操作、行内是次操作/危险操作）；
 * 2. **≤3 天的行**走警告色**并且加"即将永久删除"文字**——颜色不单独表意；
 * 3. 离线时恢复与永久删除**置灰并说明"需要联网"**（看是能看的）。
 */
import { useState } from "react";
import { Button } from "../../../app/ui/Controls";
import { Chip } from "../../../app/ui/Chip";
import { Icon } from "../../../app/ui/Icon";
import { PurgeConfirmDialog } from "./PurgeConfirmDialog";
import type { PurgeFailure, PurgeProgress, TrashRowModel } from "../model";

const TYPE_LABELS: Readonly<Record<TrashRowModel["type"], string>> = {
  note: "笔记",
  table: "表格",
  memo: "Memo",
};

export interface TrashPageProps {
  rows: readonly TrashRowModel[];
  /** 当前选中（批量操作） */
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  onRestore: (ids: readonly string[]) => void;
  onPurge: (ids: readonly string[]) => void;
  onEmpty: () => void;
  /** 批量永久删除的进度（"正在删除 10 / 24"） */
  progress?: PurgeProgress | null;
  /** 失败清单（留在列表里，给「重试」） */
  failures?: readonly PurgeFailure[];
  onRetry?: () => void;
  /** 离线：恢复与永久删除不可用并说明原因 */
  offline?: boolean;
  onBackToSettings: () => void;
}

export function TrashPage({
  rows,
  selected,
  onToggleSelect,
  onSelectAll,
  onRestore,
  onPurge,
  onEmpty,
  progress = null,
  failures = [],
  onRetry,
  offline = false,
  onBackToSettings,
}: TrashPageProps) {
  const [pending, setPending] = useState<{ kind: "purge" | "empty"; ids: string[] } | null>(null);
  const selectedIds = [...selected];

  const blockedTitle = offline ? "需要联网" : undefined;

  return (
    <div className="trashpage">
      <header className="trashpage__head">
        <Button variant="secondary" size="sm" onClick={onBackToSettings}>
          ← 返回设置
        </Button>
        <h1 className="trashpage__title">回收站</h1>
        <span className="trashpage__sub">删除的内容在这里保留 30 天（可在设置里改）</span>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setPending({ kind: "empty", ids: rows.map((row) => row.id) })}
          disabled={rows.length === 0 || offline}
          title={rows.length === 0 ? "回收站已经是空的" : blockedTitle}
        >
          清空回收站
        </Button>
      </header>

      {progress ? (
        <p className="trashpage__progress" role="status">
          {progress.label}
        </p>
      ) : null}

      {failures.length > 0 ? (
        <div className="trashpage__failures" role="alert">
          <p>{failures.length} 条没能删除，仍留在列表里</p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="trashpage__empty">
          <p className="trashpage__empty-title">回收站是空的</p>
          <p className="trashpage__empty-hint">
            删除的笔记、表格、Memo 和文件夹会在这里保留 30 天（可在设置里改）。
          </p>
          <Button variant="secondary" size="sm" onClick={onBackToSettings}>
            返回设置
          </Button>
        </div>
      ) : (
        <>
          <div className="trashpage__batchbar">
            <label className="trashpage__selectall">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === rows.length}
                onChange={(event) => onSelectAll(event.target.checked)}
              />
              全选
            </label>
            {selected.size > 0 ? (
              <>
                <span className="trashpage__count" role="status">
                  已选 {selected.size} 条
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRestore(selectedIds)}
                  disabled={offline}
                  title={blockedTitle}
                >
                  恢复选中
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setPending({ kind: "purge", ids: selectedIds })}
                  disabled={offline}
                  title={blockedTitle}
                >
                  永久删除选中
                </Button>
              </>
            ) : null}
          </div>

          <ul className="trashpage__list">
            {rows.map((row) => (
              <li key={row.id} className="trashrow">
                <input
                  type="checkbox"
                  aria-label={`选择 ${row.title}`}
                  checked={selected.has(row.id)}
                  onChange={() => onToggleSelect(row.id)}
                />

                <span className={`trashrow__icon trashrow__icon--${row.type}`} aria-hidden="true">
                  <Icon name={row.type === "table" ? "table" : "note"} size={13} />
                </span>

                <span className="trashrow__title">
                  {row.titleHidden ? <Icon name="lock" size={13} /> : null}
                  {row.title}
                  {row.inEncSpace && !row.titleHidden ? (
                    <span className="itemrow__mark" title="这条在加密空间里">
                      加密空间
                    </span>
                  ) : null}
                  {row.encSelf ? (
                    <span className="itemrow__mark" title="单篇加密：正文需逐篇解锁">
                      已加密
                    </span>
                  ) : null}
                </span>

                <span className="trashrow__meta">
                  <span>{TYPE_LABELS[row.type]}</span>
                  <span>{new Date(row.deletedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                  <span className={row.urgent ? "trashrow__remain trashrow__remain--urgent" : "trashrow__remain"}>
                    {row.remainingDays === 0 ? "今天到期" : `剩余 ${row.remainingDays} 天`}
                    {row.urgent ? " · 即将永久删除" : ""}
                  </span>
                </span>

                <span className="trashrow__actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRestore([row.id])}
                    disabled={offline}
                    title={blockedTitle}
                  >
                    恢复
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setPending({ kind: "purge", ids: [row.id] })}
                    disabled={offline}
                    title={blockedTitle}
                  >
                    永久删除
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <PurgeConfirmDialog
        open={pending !== null}
        kind={pending?.kind ?? "purge"}
        count={pending?.ids.length ?? 0}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "empty") onEmpty();
          else onPurge(pending.ids);
          setPending(null);
        }}
      />
    </div>
  );
}

/** 页头副标题里的口径也走 Chip 提示（供设置页复用同一句） */
export function TrashRetentionChip({ days }: { days: number }) {
  return <Chip variant="compact">{`保留 ${days} 天`}</Chip>;
}
