/**
 * 条目列表（左列 330px；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §四）。
 *
 * 规则：点条目**在右列直接打开**（不许走侧滑详情，DESIGN.md 禁止项 #15）；
 * 空列表必须给出口（DESIGN.md §5.4-3）；键盘可选中并用 `Enter` 打开。
 */
import type { LocalItem } from "../../../data/db";
import { Button, EmptyState } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu } from "../../../app/ui/Menu";
import { ItemListHead } from "../../../app/workarea/ItemListHead";

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
  /** 列表头标题（随视图变化：全部笔记 / 最近编辑 / 收藏 / #标签） */
  title: string;
  selectedId: string | null;
  loading: boolean;
  /** 行内摘要（已缓存正文的第一行，可缺省） */
  summaries?: Record<string, string>;
  /** 文件夹列表：给"移动到…"用（两层，扁平列出即可） */
  folders?: ReadonlyArray<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onNewNote: () => void;
  onMove?: (id: string, folderId: string | null) => void;
  onTogglePinned?: (id: string) => void;
  onToggleStarred?: (id: string) => void;
}

/** 空状态的文案随视图不同——收藏空与笔记空的原因不一样，出口也不一样 */
function emptyCopy(title: string): { title: string; hint: string } {
  if (title === "收藏") {
    return {
      title: "还没有收藏的笔记",
      hint: "在条目的更多菜单里点「收藏」，它就会出现在这里。",
    };
  }
  if (title.startsWith("# ")) {
    return { title: "这个标签下还没有笔记", hint: "换一个标签，或给笔记写上前缀 # 的标签。" };
  }
  return {
    title: "还没有笔记",
    hint: "点左上角的「新建笔记」开始写第一篇；写下的内容会先存在本机，联网后自动上传。",
  };
}

export function NoteList({
  items,
  title,
  selectedId,
  loading,
  summaries = {},
  folders = [],
  onSelect,
  onNewNote,
  onMove,
  onTogglePinned,
  onToggleStarred,
}: NoteListProps) {
  const empty = emptyCopy(title);

  return (
    <section className="listpane" aria-label="笔记列表">
      <ItemListHead title={title} count={items.length} />

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
              title={empty.title}
              hint={empty.hint}
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
              <li key={item.id} className="itemrow__wrap">
                <button
                  type="button"
                  className="itemrow"
                  aria-current={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="itemrow__title">
                    {item.pinned === 1 ? (
                      <span className="itemrow__mark" title="已置顶">
                        置顶
                      </span>
                    ) : null}
                    {item.starred === 1 ? (
                      <span className="itemrow__mark" title="已收藏">
                        收藏
                      </span>
                    ) : null}
                    {summaryOf(item)}
                  </span>
                  <span className="itemrow__meta">
                    <span>{formatTime(item.updated_at)}</span>
                    {item.pending ? <span>{PENDING_LABEL[item.pending] ?? "待上传"}</span> : null}
                  </span>
                  {summaries[item.id] ? (
                    <span className="itemrow__excerpt">{summaries[item.id]}</span>
                  ) : null}
                </button>

                <div className="itemrow__menu">
                  <DropdownMenu
                    label={`${summaryOf(item)} 的更多操作`}
                    showChevron={false}
                    trigger={<Icon name="chevron-down" size={13} />}
                    items={[
                      {
                        id: "move-root",
                        label: "移动到 根目录",
                        icon: "note",
                        disabled: (item.folder_id ?? null) === null,
                        title: (item.folder_id ?? null) === null ? "已经在根目录" : "移到根目录",
                        onSelect: () => onMove?.(item.id, null),
                      },
                      ...folders.map((folder) => ({
                        id: `move-${folder.id}`,
                        label: `移动到 ${folder.name}`,
                        icon: "folder" as const,
                        disabled: (item.folder_id ?? null) === folder.id,
                        title:
                          (item.folder_id ?? null) === folder.id ? "已经在这个文件夹里" : undefined,
                        onSelect: () => onMove?.(item.id, folder.id),
                      })),
                      {
                        id: "pin",
                        label: item.pinned === 1 ? "取消置顶" : "置顶",
                        icon: "note",
                        onSelect: () => onTogglePinned?.(item.id),
                      },
                      {
                        id: "star",
                        label: item.starred === 1 ? "取消收藏" : "收藏",
                        icon: "star",
                        onSelect: () => onToggleStarred?.(item.id),
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
