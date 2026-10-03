/**
 * 设置 › 数据管理 › 附件管理（M10-03 · M6 批 2c；设计稿 §4.2 的四块照做，不另起一版）。
 *
 * **这一屏回答三个问题**：一共占多少空间、哪些没人用了、能手动清掉多少。所以概览三数放最上面，
 * 列表给到「被多少条目引用」这一列（引用数是判断"能不能删"的唯一依据），主操作只有一个：清理孤儿。
 *
 * 三条实现取舍，都是有代价才这么定的：
 *
 * 1. **列表只取原图行**（`kind=original`）。缩略图是原图派生的第二行，让它单独占一行会让
 *    「附件总数」翻倍、同一张图在列表里出现两次。**代价**：占用空间只按原图算，不含缩略图——
 *    这条口径写在卡头 ⓘ 里，不藏着。
 * 2. **概览与筛选在客户端做，不另设接口**（设计 §4.3）。列表一次取到上限，筛选只切显示。
 *    取到的行数少于上限时**如实说**「只列出最近 N 个」，不拿截断的列表冒充全部。
 * 3. **状态按「有没有引用」判，不看 `orphaned_at`**。`orphaned_at` 只是清理那一轮打的标记，
 *    一个刚上传、还没跑过清理的文件会是 `null`——按它显示就会出现「在用 + 0 条引用」这种自相矛盾的行。
 *
 * 隐私：附件按明文存储、门禁只在正文层（功能拆解 M10-03），所以**隐私条目的附件照常显示文件名与缩略图**，
 * 这里不做任何加密过滤。
 */
import { useCallback, useEffect, useState } from "react";
import {
  ATTACHMENT_LIST_MAX_LIMIT,
  type AttachmentListResponse,
  type AttachmentListRow,
} from "@menote/shared";
import { Button, EmptyState, Pill } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { attachmentsApi } from "../../../data/api/endpoints";
import { UNNAMED_ATTACHMENT, attachmentUrl, formatBytes, isImageMime } from "../model";

type StateFilter = "all" | "active" | "orphaned";

const STATE_FILTERS: ReadonlyArray<{ id: StateFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "active", label: "在用" },
  { id: "orphaned", label: "孤儿" },
];

/** 状态按引用数判：`orphaned_at` 是标记不是事实（见文件头第 3 条） */
function stateOf(row: AttachmentListRow): Exclude<StateFilter, "all"> {
  return row.ref_count === 0 ? "orphaned" : "active";
}

function nameOf(row: AttachmentListRow): string {
  return row.filename?.trim() || UNNAMED_ATTACHMENT;
}

export function AttachmentManagerPage() {
  const [rows, setRows] = useState<AttachmentListRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StateFilter>("all");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<AttachmentListResponse> => {
    return attachmentsApi.list({ kind: "original", limit: ATTACHMENT_LIST_MAX_LIMIT });
  }, []);

  const refresh = useCallback((): Promise<void> => {
    return load()
      .then((result) => {
        setRows(result.attachments);
        setHasMore(result.has_more);
        setError(null);
      })
      .catch((cause: unknown) => {
        // 失败时**保持错误可见**（DESIGN.md §5.4-2），不用会自动消失的提示承载
        setError(cause instanceof Error ? cause.message : "附件列表加载失败");
        setRows([]);
      });
  }, [load]);

  useEffect(() => {
    let alive = true;
    void load()
      .then((result) => {
        if (alive) {
          setRows(result.attachments);
          setHasMore(result.has_more);
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "附件列表加载失败");
          setRows([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [load]);

  /*
    三次数下来回都作用在**至多 200 行**的列表上（取数时就把上限给定死了），所以直接算，
    不套 useMemo —— 那样只会多一处要跟 `rows ?? []` 的恒等性较劲的依赖。
  */
  const all = rows ?? [];
  const totalBytes = all.reduce((sum, row) => sum + row.size_bytes, 0);
  const orphanCount = all.filter((row) => stateOf(row) === "orphaned").length;
  const visible = filter === "all" ? all : all.filter((row) => stateOf(row) === filter);

  async function runGc(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const result = await attachmentsApi.gc();
      setNotice(
        result.removed > 0
          ? `已清理 ${result.removed} 个到期孤儿附件`
          : `已标记 ${result.marked} 个孤儿附件；它们要满 30 天才会真正删除`,
      );
      setConfirming(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="setcard" aria-label="附件概览">
        <h3 className="setcard__title">
          附件概览
          <InfoHint label="附件概览说明">
            这里只统计**原图**：缩略图由原图派生、单独占一行会让同一张图出现两次，所以不计入总数与占用。
            孤儿指**没有任何条目引用**的附件；标为孤儿后还要满 30 天才会真正删除，期间重新被引用就不会被删。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">附件总数</span>
          </div>
          <span className="setrow__control">{all.length} 个</span>
        </div>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">占用空间</span>
          </div>
          <span className="setrow__control">{formatBytes(totalBytes)}</span>
        </div>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">孤儿附件</span>
          </div>
          <span className="setrow__control">{orphanCount} 个</span>
        </div>
        {/* 实时计数不许藏进 ⓘ（DESIGN.md §5.4-2），所以截断这件事直接说在页面上 */}
        {hasMore ? (
          <p className="hint-line">只列出最近 {all.length} 个附件，更早的请在正文里找。</p>
        ) : null}
      </section>

      <section className="setcard" aria-label="附件列表">
        <h3 className="setcard__title">
          附件列表
          <div className="segmented" role="group" aria-label="按状态筛选">
            {STATE_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="segmented__item"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </h3>

        {error !== null ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice !== null ? <p className="hint-line">{notice}</p> : null}

        {rows === null ? <p className="hint-line">正在读取…</p> : null}

        {/* 读失败时**不写空态**：那句「还没有附件」在读不出来的时候是假的（DESIGN.md §5.4-2） */}
        {rows !== null && error === null && visible.length === 0 && all.length === 0 && filter === "all" ? (
          <EmptyState title="还没有附件" hint="在笔记正文里粘贴或插入图片，文件会自动上传到这里。" />
        ) : null}

        {rows !== null && error === null && visible.length === 0 && (all.length > 0 || filter !== "all") ? (
          <EmptyState
            title="没有符合这个筛选的附件"
            hint="换一个筛选看看，或者回到「全部」。"
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                回到全部
              </Button>
            }
          />
        ) : null}

        {visible.map((row) => (
          <AttachmentRow key={row.id} row={row} />
        ))}
      </section>

      <section className="setcard" aria-label="清理孤儿附件">
        <h3 className="setcard__title">
          清理孤儿附件
          <InfoHint label="清理孤儿说明">
            清理分两步：先把**没有任何条目引用**的附件标为孤儿，再删掉其中已标满 30 天的那些。
            重新被引用的附件不会出现在这一步里；正文里已删掉引用但还没满 30 天的也不会被立刻删。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">手动清理孤儿附件</span>
            {/* 没有可清理对象时把原因**平铺**出来，不让禁用只靠悬停（DESIGN.md §6.1） */}
            <span className="setrow__desc">
              {orphanCount > 0 ? `当前有 ${orphanCount} 个孤儿附件可标记` : "当前没有可清理的孤儿附件"}
            </span>
          </div>
          <span className="setrow__control">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || orphanCount === 0}
              onClick={() => setConfirming(true)}
            >
              {busy ? "清理中…" : "清理孤儿附件"}
            </Button>
          </span>
        </div>
      </section>

      <Modal
        open={confirming}
        title="清理孤儿附件"
        desc={`将标记 ${orphanCount} 个没有任何条目引用的附件，并永久删除其中已标满 30 天的那些。删除不可撤销，占用的空间会真正释放。`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void runGc()}>
              {busy ? "清理中…" : `确认清理 ${orphanCount} 个`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </>
        }
      >
        <p className="hint-line">
          正在使用的附件不会被删：只有引用数为 0 的才会被标记，标满 30 天后才真正删除。
        </p>
      </Modal>
    </>
  );
}

/**
 * 列表一行：缩略图 + 文件名 / 类型 · 尺寸 · 大小 · 引用数，右侧一个状态胶囊。
 *
 * **没有缩略图就回退文件图标**（设计 §4.2）：非图片本来就没有缩略图，图片的缩略图也可能没生成成功，
 * 两种都走 `onError` 换图标，不留破图。
 */
function AttachmentRow({ row }: { row: AttachmentListRow }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const state = stateOf(row);
  const dimensions =
    row.width != null && row.height != null ? `${row.width}×${row.height}` : "尺寸未知";

  return (
    <div className="setrow">
      <div className="setrow__label">
        {/* `.attachment-link` 就是「小方块 + 文字 + gap」那一行版式（缩略图 28px 走行内尺寸，不新增 CSS） */}
        <span className="attachment-link">
          {isImageMime(row.mime, nameOf(row)) && !thumbFailed ? (
            <img
              src={attachmentUrl(row.sha256, { thumb: true })}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: 28, height: 28, objectFit: "cover", borderRadius: "var(--radius)" }}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <Icon name={isImageMime(row.mime, nameOf(row)) ? "image" : "note"} size={20} />
          )}
          <span className="setrow__name">{nameOf(row)}</span>
        </span>
        <span className="setrow__desc">
          {row.mime ?? "类型未知"} · {dimensions} · {formatBytes(row.size_bytes)} · 被 {row.ref_count} 条
          条目引用
        </span>
      </div>
      <div className="setrow__control">
        <Pill tone={state === "active" ? "ok" : "neutral"}>{state === "active" ? "在用" : "孤儿"}</Pill>
      </div>
    </div>
  );
}
