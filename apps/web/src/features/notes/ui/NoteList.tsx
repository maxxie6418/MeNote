/**
 * 条目列表（左列 330px；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §四）。
 *
 * 规则：点条目**在右列直接打开**（不许走侧滑详情，DESIGN.md 禁止项 #15）；
 * 空列表必须给出口（DESIGN.md §5.4-3）；键盘可选中并用 `Enter` 打开。
 */
import type { LocalItem } from "../../../data/db";
import { Button, EmptyState } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";

const PENDING_LABEL: Record<string, string> = {
  create: "待上传",
  save_body: "待上传",
  patch_meta: "待上传",
};

function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function summaryOf(item: LocalItem): string {
  return item.title ?? "（无标题）";
}

export interface NoteListProps {
  items: LocalItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNewNote: () => void;
}

export function NoteList({ items, selectedId, loading, onSelect, onNewNote }: NoteListProps) {
  return (
    <section className="listpane" aria-label="笔记列表">
      <div className="listpane__head">
        <h2 className="listpane__title">全部笔记</h2>
        <span className="listpane__count">{items.length} 条</span>
      </div>

      <div className="listpane__scroll">
        {loading ? (
          <div style={{ display: "grid", gap: 10, padding: 8 }}>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "var(--sp-6) var(--sp-4)" }}>
            <EmptyState
              title="还没有笔记"
              hint="点左上角的「新建笔记」开始写第一篇；写下的内容会先存在本机，联网后自动上传。"
              action={
                <Button variant="secondary" size="sm" onClick={onNewNote}>
                  <Icon name="plus" size={13} />
                  新建笔记
                </Button>
              }
            />
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="itemrow"
                  aria-current={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="itemrow__title">{summaryOf(item)}</span>
                  <span className="itemrow__meta">
                    <span>{formatTime(item.updated_at)}</span>
                    {item.pending ? <span>{PENDING_LABEL[item.pending] ?? "待上传"}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
