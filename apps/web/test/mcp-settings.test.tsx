// @vitest-environment jsdom
/**
 * 设置 › MCP（M6 批 4）的界面侧契约。
 *
 * 盯的是界面稿里那几条**"容易被实现漏掉"**的口径：
 * - 完整令牌**只显示一次**：关掉弹窗就没有第二次机会（所以那一态不许点遮罩关）；
 * - 撤销**行内二次确认 + 后果平铺**（DESIGN.md §5.4-2、§6.5）；
 * - 达上限时「创建令牌」**置灰且给出可见原因**（§6.1：不可只置灰）；
 * - 读失败**不写空态**（那时候"还没有令牌"是假的）；
 * - 勾「允许通过 URL 使用」才出现风险说明，且必须**平铺**（§5.4-2：警告不得藏进 ⓘ）；
 * - 范围候选**只列顶层**、**加密空间不进候选**（用户 2026-10-03 拍板 + 服务端会拒）。
 *
 * 数据来源按既有做法 `vi.mock` 掉两个模块（与 `attachment-manager.test.tsx` 同款）：
 * 接口层与本地缓存表——本屏自己拿数据，不走 props。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_MAX_ACTIVE_TOKENS, type McpAuditEntry, type McpTokenRecord } from "@menote/shared";
import { McpSettingsPage } from "../src/features/mcp/ui/McpSettingsPage";

const NOW = Date.now();

interface ServerState {
  tokens: McpTokenRecord[];
  listError: string | null;
  audit: McpAuditEntry[];
  titles: Record<string, string>;
  folders: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    depth: number;
    in_enc_space: number;
    is_enc_space: number;
  }>;
}

let state: ServerState = {
  tokens: [],
  listError: null,
  audit: [],
  titles: {},
  folders: [
    { id: "f1", name: "工作", parent_id: null, depth: 1, in_enc_space: 0, is_enc_space: 0 },
    { id: "f1a", name: "工作A", parent_id: "f1", depth: 2, in_enc_space: 0, is_enc_space: 0 },
    { id: "f2", name: "生活", parent_id: null, depth: 1, in_enc_space: 0, is_enc_space: 0 },
    { id: "vault", name: "加密空间", parent_id: null, depth: 0, in_enc_space: 0, is_enc_space: 1 },
  ],
};

const created: { secret: string; token: McpTokenRecord }[] = [];

vi.mock("../src/data/api/endpoints", () => ({
  mcpApi: {
    list: async (): Promise<{ tokens: McpTokenRecord[] }> => {
      if (state.listError !== null) throw new Error(state.listError);
      return { tokens: state.tokens };
    },
    create: async (input: { name: string }): Promise<{ secret: string; token: McpTokenRecord }> => {
      const record: McpTokenRecord = {
        id: `new-${created.length + 1}`,
        name: input.name,
        token_prefix: "mn_3fK2…",
        perms: 1,
        folder_scope: null,
        include_memos: 0,
        allow_url: 0,
        rate_per_min: 60,
        expires_at: null,
        created_at: NOW,
        last_used_at: null,
        revoked_at: null,
        status: "active",
      };
      state.tokens = [record];
      const result = { secret: "mn_COMPLETE_TOKEN_VALUE", token: record };
      created.push(result);
      return result;
    },
    revoke: async (id: string): Promise<McpTokenRecord> => {
      const found = state.tokens.find((row) => row.id === id);
      if (!found) throw new Error("令牌不存在");
      found.status = "revoked";
      found.revoked_at = NOW;
      return found;
    },
    audit: async (): Promise<{ entries: McpAuditEntry[]; next_cursor: string | null }> => ({
      entries: state.audit,
      next_cursor: null,
    }),
  },
}));

vi.mock("../src/data/db/repository", () => ({
  listLocalFolders: async () =>
    state.folders.map((folder) => ({
      ...folder,
      is_enc_space: folder.is_enc_space as 0 | 1,
      in_enc_space: folder.in_enc_space as 0 | 1,
      position: 0,
      meta_rev: 1,
      sync_seq: 0,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      deleted: false,
      pending: null,
    })),
  listLocalItems: async () =>
    Object.entries(state.titles).map(([id, title]) => ({ id, title, deleted: false })),
}));

function token(overrides: Partial<McpTokenRecord> = {}): McpTokenRecord {
  return {
    id: "t1",
    name: "公司电脑的 Cursor",
    token_prefix: "mn_3fK2…",
    perms: 1,
    folder_scope: null,
    include_memos: 0,
    allow_url: 0,
    rate_per_min: 60,
    expires_at: null,
    created_at: NOW - 86_400_000,
    last_used_at: NOW - 2 * 3_600_000,
    revoked_at: null,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  created.length = 0;
  state = {
    tokens: [token()],
    listError: null,
    audit: [],
    titles: {},
    folders: [
      { id: "f1", name: "工作", parent_id: null, depth: 1, in_enc_space: 0, is_enc_space: 0 },
      { id: "f1a", name: "工作A", parent_id: "f1", depth: 2, in_enc_space: 0, is_enc_space: 0 },
      { id: "f2", name: "生活", parent_id: null, depth: 1, in_enc_space: 0, is_enc_space: 0 },
      { id: "vault", name: "加密空间", parent_id: null, depth: 0, in_enc_space: 0, is_enc_space: 1 },
    ],
  };
});

afterEach(cleanup);

describe("设置 › MCP：地址与接入说明", () => {
  it("地址是 origin + /mcp；接入说明默认不平铺，点了才出来", async () => {
    render(<McpSettingsPage />);

    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeTruthy();
    // 辅助说明默认**不**在正文里（DESIGN.md §5.4-1）
    expect(screen.queryByText(/Cursor、Claude Code、Codex/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "接入说明" }));
    expect(screen.getByText(/Cursor、Claude Code、Codex/)).toBeTruthy();
  });
});

describe("设置 › MCP：令牌列表", () => {
  it("一行给全七项：名称、前缀、权限、范围、过期、最近使用、状态", async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("公司电脑的 Cursor")).toBeTruthy());

    expect(screen.getByText("mn_3fK2…")).toBeTruthy();
    // 没勾的权限位**不列**（不写"未授予修改和移动"这种否定式）
    expect(screen.getByText("只读 · 全部内容")).toBeTruthy();
    expect(screen.getByText(/永不过期/)).toBeTruthy();
    expect(screen.getByText(/最近使用 2 小时前/)).toBeTruthy();
    expect(screen.getByText("生效中")).toBeTruthy();
  });

  it("空态给出口：为什么空 + 下一步 + 一个「创建令牌」", async () => {
    state.tokens = [];
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("还没有令牌")).toBeTruthy());
    expect(screen.getByText(/把它和上面的地址一起交给/)).toBeTruthy();
  });

  it("读失败不写空态（「还没有令牌」在读不出来时是假的）", async () => {
    state.listError = "网络不通";
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("网络不通")).toBeTruthy();
    expect(screen.queryByText("还没有令牌")).toBeNull();
  });

  it("达上限：创建置灰**且**给出可见原因（不可只置灰）", async () => {
    state.tokens = Array.from({ length: MCP_MAX_ACTIVE_TOKENS }, (_, index) =>
      token({ id: `t${index}`, name: `令牌${index}` }),
    );
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText(/已达 20 个上限/)).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "创建令牌" }).every((b) => b.hasAttribute("disabled"))).toBe(true);
  });
});

describe("设置 › MCP：撤销", () => {
  it("行内二次确认 + 后果平铺；确认后状态变「已撤销」", async () => {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("公司电脑的 Cursor")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    // 后果**平铺可见**（DESIGN.md §5.4-2），不只是有个二次确认框
    expect(screen.getByText(/撤销后这枚令牌立刻失效/)).toBeTruthy();
    expect(screen.getByText(/无法恢复/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(screen.getByText("已撤销")).toBeTruthy());
  });

  it("已撤销的行仍能查审计（撤掉了就看不到了，那正是判断依据）", async () => {
    state.tokens = [token({ status: "revoked", revoked_at: NOW })];
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("已撤销")).toBeTruthy());
    expect(screen.getByRole("button", { name: "审计记录" })).toBeTruthy();
    // 已撤销的不再给「撤销」（没意义）
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  });
});

describe("设置 › MCP：创建弹窗", () => {
  async function openDialog(): Promise<void> {
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("还没有令牌")).toBeTruthy());
    await userEvent.click(screen.getAllByRole("button", { name: "创建令牌" })[0]!);
  }

  it("默认全关：只读恒含、三个权限位不勾、含 Memo 不勾、URL 方式不勾", async () => {
    state.tokens = [];
    await openDialog();

    expect(screen.getByText("✓ 只读（始终包含）")).toBeTruthy();
    for (const label of ["新建和追加", "修改和移动", "移到回收站"]) {
      expect(screen.getByRole("switch", { name: `授予「${label}」权限` }).getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.getByRole("switch", { name: "允许这枚令牌读写 Memo" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "允许这枚令牌通过 URL 使用" }).getAttribute("aria-checked")).toBe("false");
    // 风险说明**没勾就不出现**
    expect(screen.queryByText(/会出现在各种日志里/)).toBeNull();
  });

  it("勾「允许通过 URL 使用」后风险说明**平铺**出现（警告不得藏进 ⓘ）", async () => {
    state.tokens = [];
    await openDialog();
    await userEvent.click(screen.getByRole("switch", { name: "允许这枚令牌通过 URL 使用" }));

    const risk = screen.getByText(/会出现在各种日志里/);
    expect(risk).toBeTruthy();
    // 它是正文里的一段，不是 InfoHint（ⓘ 是 role=button）
    expect(risk.closest("button")).toBeNull();
  });

  it("名称必填：空着提交就地报错", async () => {
    state.tokens = [];
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByText("名称必填")).toBeTruthy();
  });

  it("范围只列顶层、且加密空间不进候选", async () => {
    state.tokens = [];
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "指定文件夹" }));

    // 顶层带子夹计数；子夹与加密空间都不列
    expect(screen.getByText("工作（1）")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /工作A/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /加密空间/ })).toBeNull();
  });

  it("选「指定文件夹」但一个没勾：就地报错，不静默放过", async () => {
    state.tokens = [];
    await openDialog();
    await userEvent.type(screen.getByLabelText("名称"), "家里 NAS 脚本");
    await userEvent.click(screen.getByRole("button", { name: "指定文件夹" }));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByText(/请至少选一个文件夹/)).toBeTruthy();
  });
});

describe("设置 › MCP：一次性令牌", () => {
  it("创建成功后原地切到「已创建」态；关掉之后列表里只剩前缀", async () => {
    state.tokens = [];
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("还没有令牌")).toBeTruthy());
    await userEvent.click(screen.getAllByRole("button", { name: "创建令牌" })[0]!);
    await userEvent.type(screen.getByLabelText("名称"), "公司电脑的 Cursor");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(screen.getByLabelText("完整令牌")).toBeTruthy());
    // 「只显示一次」的后果**平铺可见**
    expect(screen.getByText(/唯一一次显示完整令牌/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "我已保存" }));
    await waitFor(() => expect(screen.getByText("mn_3fK2…")).toBeTruthy());
    // 关掉之后完整串不再有第二次机会
    expect(screen.queryByLabelText("完整令牌")).toBeNull();
  });
});

describe("设置 › MCP：审计", () => {
  it("只记写类调用：空态要说清「读操作不记在这里」", async () => {
    state.audit = [];
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("公司电脑的 Cursor")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "审计记录" }));

    await waitFor(() => expect(screen.getByText("这枚令牌还没有执行过写操作")).toBeTruthy());
    expect(screen.getByText(/搜索、读内容这类操作不记在这里/)).toBeTruthy();
  });

  it("工具名给中文；条目标题而不是内部 id；被拒绝显眼", async () => {
    state.audit = [
      {
        id: "a1",
        tool: "trash_item",
        item_id: "i1",
        rev_before: 3,
        rev_after: null,
        result: "denied",
        operation_id: "op1",
        at: NOW - 60_000,
      },
    ];
    state.titles = { i1: "要删的那篇" };
    render(<McpSettingsPage />);
    await waitFor(() => expect(screen.getByText("公司电脑的 Cursor")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "审计记录" }));

    // 匹配**整行**而不是单个词：弹窗顶部的说明句里也含「移到回收站」
    await waitFor(() => expect(screen.getByText(/移到回收站 · 要删的那篇/)).toBeTruthy());
    // 不把内部 id 当标题摆出来
    expect(screen.queryByText(/i1/)).toBeNull();
    expect(screen.getByText("被拒绝")).toBeTruthy();
  });
});
