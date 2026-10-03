/**
 * 令牌审计弹窗（M6 批 4；界面稿 §五；功能拆解 M17-02）。
 *
 * **形态是弹窗而不是行内展开**（用户 2026-10-03 拍板）：90 天的记录可能几十上百条，
 * 内嵌展开会让每个令牌行高度暴涨、列表参差；弹窗一次只展示一份，也不打断你看别的令牌。
 *
 * ## 四条口径
 *
 * - **只记写类工具**（设计 §七），所以这个列表天然稀疏；空态要把这点说明白，
 *   否则用户会以为"这枚令牌没在工作"。
 * - **`denied`（被拒绝）显眼**：它正是「agent 越权尝试」的证据，审查看的就是这个。
 * - **条目标题取不到就给「已不存在的条目」**，不给链接也不回显 id——内部标识不是给人
 *   操作的东西，把它当标题摆出来反而像是个能点的入口。
 * - **切换令牌靠重挂载**（调用方给 `key={auditing?.id}`），所以状态随挂载初始化，
 *   effect 里不做同步 setState（首屏加载态由 `page === null` 承担）。
 */
import { useCallback, useEffect, useState } from "react";
import type { McpAuditEntry, McpTokenRecord } from "@menote/shared";
import { Button, EmptyState, Pill } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { auditResultLabel, formatTimestamp, GONE_ITEM_LABEL, toolLabel } from "../model";

export interface TokenAuditDialogProps {
  token: McpTokenRecord | null;
  onClose: () => void;
  /** 拉一页；`cursor` 为 null 表示第一页 */
  load: (options: { limit?: number; cursor?: string | null }) => Promise<{
    entries: McpAuditEntry[];
    next_cursor: string | null;
  }>;
  /**
   * 条目标题解析：审计表里存的是 `item_id`，这一屏从**本地缓存**把标题取出来。
   * 解析失败不打断这一屏——取不到的显示「已不存在的条目」。
   */
  resolveLabels: (itemIds: readonly string[]) => Promise<Map<string, string>>;
}

const PAGE_SIZE = 50;

interface AuditPage {
  entries: McpAuditEntry[];
  nextCursor: string | null;
  labels: Map<string, string>;
}

export function TokenAuditDialog({ token, onClose, load, resolveLabels }: TokenAuditDialogProps) {
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);

  // 首屏：所有 setState 都在 promise 回调里，effect 体内没有同步 setState
  useEffect(() => {
    if (token === null) return;
    let alive = true;
    void load({ limit: PAGE_SIZE, cursor: null })
      .then(async (result) => {
        const ids = result.entries
          .map((entry) => entry.item_id)
          .filter((id): id is string => id !== null);
        const labels = ids.length > 0 ? await resolveLabels(ids) : new Map<string, string>();
        if (alive) {
          setPage({ entries: result.entries, nextCursor: result.next_cursor, labels });
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "调用记录加载失败");
        setPage({ entries: [], nextCursor: null, labels: new Map() });
      });
    return () => {
      alive = false;
    };
  }, [token, load, resolveLabels]);

  /** 「加载更多」是事件处理器，可以放心同步置 busy */
  const loadMore = useCallback(async (): Promise<void> => {
    if (page === null || page.nextCursor === null) return;
    setMoreBusy(true);
    try {
      const result = await load({ limit: PAGE_SIZE, cursor: page.nextCursor });
      const ids = result.entries
        .map((entry) => entry.item_id)
        .filter((id): id is string => id !== null);
      const labels = ids.length > 0 ? await resolveLabels(ids) : new Map<string, string>();
      setPage((current) =>
        current === null
          ? current
          : {
              entries: [...current.entries, ...result.entries],
              nextCursor: result.next_cursor,
              labels: new Map([...current.labels, ...labels]),
            },
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "调用记录加载失败");
    } finally {
      setMoreBusy(false);
    }
  }, [page, load, resolveLabels]);

  const entries = page?.entries ?? null;

  return (
    <Modal
      open={token !== null}
      title="调用记录"
      desc={token === null ? undefined : token.name}
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭
        </Button>
      }
    >
      {/* 保留期是说明性文字，收进 ⓘ（DESIGN.md §5.4-1：不平铺） */}
      <p className="hint-line">
        只记录写操作（新建、追加、修改、整理、移到回收站）。搜索与读取不在这里。
        <InfoHint label="保留多久">记录保留 90 天，超过就查不到了。</InfoHint>
      </p>

      {error !== null ? (
        <div role="alert" className="hint-line">
          <span>{error}</span>
        </div>
      ) : null}

      {entries === null ? <p className="hint-line">正在读取…</p> : null}

      {entries !== null && entries.length === 0 ? (
        <EmptyState
          title="这枚令牌还没有执行过写操作"
          hint="搜索、读内容这类操作不记在这里。要看它有没有被用过，去令牌列表的「最近使用」。"
        />
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <div className="setcard">
          {entries.map((entry) => {
            const result = auditResultLabel(entry.result);
            return (
              <div key={entry.id} className="setrow">
                <div className="setrow__label">
                  <span>
                    {formatTimestamp(entry.at)} · {toolLabel(entry.tool)} ·{" "}
                    {entry.item_id === null ? "—" : (page?.labels.get(entry.item_id) ?? GONE_ITEM_LABEL)}
                  </span>
                </div>
                <div className="setrow__control">
                  <Pill tone={result.tone} title={result.label}>
                    {result.label}
                  </Pill>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {page !== null && page.nextCursor !== null ? (
        <Button variant="secondary" size="sm" disabled={moreBusy} onClick={() => void loadMore()}>
          {moreBusy ? "正在读取…" : "加载更多"}
        </Button>
      ) : null}
    </Modal>
  );
}
