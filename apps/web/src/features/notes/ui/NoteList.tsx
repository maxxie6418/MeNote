/**
 * 条目列表（左列 330px；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §四）。
 *
 * 规则：点条目**在右列直接打开**（不许走侧滑详情，DESIGN.md 禁止项 #15）；
 * 空列表必须给出口（DESIGN.md §5.4-3）；键盘可选中并用 `Enter` 打开。
 */
import type { LocalItem } from "../../../data/db";
import { Button, EmptyState } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
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
  /**
   * 删除（M4-12）：**只报事件**，二次确认与"移入回收站"由上层做——
   * 列表行不该自己弹确认框（同一个确认逻辑还要给编辑器「更多」菜单用）。
   */
  onDelete?: (id: string) => void;
  /**
   * 加密空间的移入/移出（M3-8；《隐私锁设计》§6.3、§8）。
   *
   * 三条口径直接体现在菜单里：
   * - **未启用隐私锁**：不提供移入入口，菜单项置灰并说明去哪里启用；
   * - **锁定态**：只能移入**空间根**（`folders` 传空即可，内部层级此时不可见）；**移出**不可用（要先解锁）；
   * - 已在空间里的条目才显示「移出加密空间」。
   */
  vault?: {
    enabled: boolean;
    locked: boolean;
    /** 空间根 id；还没同步下来时给 `null`（此时不给移入入口） */
    id: string | null;
    /** 空间内文件夹（锁定时应为空数组） */
    folders: ReadonlyArray<{ id: string; name: string }>;
    onMoveIn: (itemId: string, folderId: string | null) => void;
    onMoveOut: (itemId: string) => void;
  };
  /**
   * 本次浏览器会话里**已逐篇解密**的条目 id（M3-10）。
   *
   * 它决定列表行显示"已加密"还是"已解密"——两套标识里的**单篇态**：
   * 单篇门禁与隐私锁态互不影响，所以这里单独传，不从 gate 里猜。
   */
  unlockedItemIds?: ReadonlySet<string>;
  /**
   * 可承载动作的面板提示（M4-12 的「撤销」）。
   *
   * 为什么不是轻提示：`DESIGN.md` §6.6 明确"轻提示**不承载需要用户行动的信息**（会被错过）"，
   * 而界面稿 §6.6 要求删除后"提供撤销"。两个都满足的做法就是把它放进**面板提示**——
   * 区块内信息条，本来就是这个用途（需要持续可见的说明与后果）。
   */
  notice?: {
    message: string;
    actionLabel: string;
    onAction: () => void;
  } | null;
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
  vault,
  unlockedItemIds,
  onDelete,
  notice,
}: NoteListProps) {
  const empty = emptyCopy(title);
  /** 这一篇在本次浏览器会话里是否已解密（单篇门禁与隐私锁态无关，故单独问） */
  const itemUnlocked = (itemId: string): boolean => unlockedItemIds?.has(itemId) ?? false;

  return (
    <section className="listpane" aria-label="笔记列表">
      {notice ? (
        <div className="panel-hint" role="status">
          <span>{notice.message}</span>
          <button type="button" className="link" onClick={notice.onAction}>
            {notice.actionLabel}
          </button>
        </div>
      ) : null}
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
                    {/*
                      M3-10 的两套标识（设计 §9.2-③）必须能分辨、也可同时出现：
                      - **单篇加密态**：未解密 → 锁 + "已加密"；本次已解密 → "已解密"；
                      - **空间归属**：解锁期间出现在三视图里 → 锁 + "加密空间"。
                      标题本身是明文，所以标识与标题并存不冲突。
                    */}
                    {item.enc_self === 1 ? (
                      <span
                        className="itemrow__mark"
                        title={
                          itemUnlocked(item.id)
                            ? "单篇加密：本次会话已解密"
                            : "单篇加密：正文需逐篇解锁"
                        }
                      >
                        <Icon name="lock" size={13} />
                        {itemUnlocked(item.id) ? "已解密" : "已加密"}
                      </span>
                    ) : null}
                    {item.in_enc_space === 1 ? (
                      <span className="itemrow__mark" title="这一条在加密空间里">
                        <Icon name="lock" size={13} />
                        加密空间
                      </span>
                    ) : null}
                    {summaryOf(item)}
                  </span>
                  <span className="itemrow__meta">
                    <span>{formatTime(item.updated_at)}</span>
                    {item.pending ? <span>{PENDING_LABEL[item.pending] ?? "待上传"}</span> : null}
                  </span>
                  {/*
                    摘要在锁定时换成"已加密"：正文没解密就不该露内容面的任何线索
                    （连摘要也不给——摘要就是从正文里取的）
                  */}
                  {item.enc_self === 1 && !itemUnlocked(item.id) ? (
                    <span className="itemrow__excerpt">已加密</span>
                  ) : summaries[item.id] ? (
                    <span className="itemrow__excerpt">{summaries[item.id]}</span>
                  ) : null}
                </button>

                <div className="itemrow__menu">
                  <DropdownMenu
                    label={`${summaryOf(item)} 的更多操作`}
                    showChevron={false}
                    trigger={<Icon name="more" size={13} />}
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
                      ...(vault
                        ? item.in_enc_space === 1
                          ? ([
                              {
                                id: "vault-out",
                                label: "移出加密空间",
                                icon: "lock" as const,
                                // 移出意味着要处理面明文：必须先解锁（走查表第 16 行）
                                disabled: vault.locked,
                                title: vault.locked
                                  ? "先解锁隐私锁，才能把内容移出加密空间"
                                  : "移到根目录，之后按普通内容对待",
                                onSelect: () => vault.onMoveOut(item.id),
                              },
                            ] satisfies MenuItemSpec[])
                          : ([
                              {
                                id: "vault-in",
                                label: "移入加密空间",
                                icon: "lock" as const,
                                disabled: !vault.enabled || vault.id === null,
                                title: !vault.enabled
                                  ? "先在「设置 › 隐私锁」启用隐私锁"
                                  : vault.id === null
                                    ? "加密空间还没同步下来，请稍后重试"
                                    : undefined,
                                onSelect: () => vault.onMoveIn(item.id, null),
                              },
                              // 锁定时 `folders` 为空 → 只给"入根"这一条（设计 §6.3 与走查第 15 行）
                              ...vault.folders.map((folder) => ({
                                id: `vault-in-${folder.id}`,
                                label: `移入 加密空间/${folder.name}`,
                                icon: "folder" as const,
                                onSelect: () => vault.onMoveIn(item.id, folder.id),
                              })),
                            ] satisfies MenuItemSpec[])
                        : []),
                      // 删除（M4-12）：破坏性操作 → 危险色，且执行前必须二次确认（确认框在 NotesPane 里）
                      ...(onDelete
                        ? ([
                            {
                              id: "delete",
                              label: "删除",
                              icon: "logout" as const,
                              danger: true,
                              onSelect: () => onDelete(item.id),
                            },
                          ] satisfies MenuItemSpec[])
                        : []),
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
