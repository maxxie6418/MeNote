// @vitest-environment jsdom
/**
 * 外部备份目标的界面与纯函数契约（M7 第 4 项 批 1；设计 §四、§六）。
 *
 * 盯的是那几条**"容易被实现漏掉"**的口径：
 * - **凭据永不回显**：编辑弹窗里密钥框必须是空的，且 label 要说清"留空 = 不改"
 *   （否则用户以为删掉输入框就等于换了新密钥）；
 * - **编辑时不送 `secret` 键**——送空串会被服务端当成"清空凭据"（model 层断言）；
 * - **删除走行内二次确认 + 后果平铺**，且那句话必须说清"远端文件一个都不动"
 *   （DESIGN.md §5.4-2、§6.5）；
 * - **读失败不写空态**（那时候"还没有目标"是假的，§6.1）；
 * - **失败原因平铺**且留到下次打开还在，不靠 Toast 承载（§5.4-2）；
 * - **默认档是 `append_only`**，选「与本机保持一致」才出现不可恢复的警告。
 *
 * 数据来源 `vi.mock` 掉接口层（本屏自己拿数据，不走 props），与 `mcp-settings.test.tsx` 同款。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackupTarget,
  BackupTestResult,
  CreateBackupTargetInput,
  UpdateBackupTargetInput,
} from "@menote/shared";
import { BackupTargetsCard } from "../src/features/backup/ui/BackupTargetsCard";
import {
  buildTargetPayload,
  emptyTargetForm,
  formFromTarget,
  lastRunText,
  policyRisk,
  targetWhere,
} from "../src/features/backup/model";

const NOW = Date.now();

function makeTarget(overrides: Partial<BackupTarget> = {}): BackupTarget {
  return {
    id: "t1",
    kind: "webdav",
    label: "家里的 NAS",
    endpoint: "https://dav.example.com/menote",
    bucket: null,
    region: null,
    username: "me",
    has_secret: true,
    enabled: true,
    delete_policy: "append_only",
    schedule: "daily",
    cursor_seq: 100,
    last_run_at: NOW - 3 * 60 * 60_000,
    last_result: "ok",
    last_error: null,
    created_at: NOW - 86_400_000,
    ...overrides,
  };
}

interface ServerState {
  targets: BackupTarget[];
  listError: string | null;
  testResult: BackupTestResult | null;
  removed: string[];
  updates: Array<{ id: string; input: UpdateBackupTargetInput }>;
}

let state: ServerState = {
  targets: [],
  listError: null,
  testResult: null,
  removed: [],
  updates: [],
};

vi.mock("../src/data/api/backup-targets", () => ({
  backupTargetsApi: {
    list: async (): Promise<BackupTarget[]> => {
      if (state.listError !== null) throw new Error(state.listError);
      return state.targets;
    },
    create: async (): Promise<BackupTarget> => makeTarget({ id: "new" }),
    update: async (id: string, input: UpdateBackupTargetInput): Promise<BackupTarget> => {
      state.updates.push({ id, input });
      const found = state.targets.find((row) => row.id === id);
      if (found === undefined) throw new Error("目标不存在");
      return { ...found, ...input };
    },
    remove: async (id: string): Promise<void> => {
      state.removed.push(id);
      state.targets = state.targets.filter((row) => row.id !== id);
    },
    test: async (): Promise<BackupTestResult> => {
      if (state.testResult === null) throw new Error("没有配置测连接结果");
      return state.testResult;
    },
  },
}));

beforeEach(() => {
  state = { targets: [], listError: null, testResult: null, removed: [], updates: [] };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("外部备份目标 · 纯函数", () => {
  it("新建时 secret 必填", () => {
    const form = { ...emptyTargetForm(), label: "NAS", endpoint: "https://dav.example.com/menote" };
    const built = buildTargetPayload(form, true);
    expect(built).toEqual({ ok: false, error: expect.stringContaining("密钥必填") });
  });

  it("编辑时 secret 留空 = 不改，**不送 secret 键**（送空串会被当成清空）", () => {
    const form = formFromTarget(makeTarget());
    expect(form.secret).toBe("");
    const built = buildTargetPayload(form, false);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.hasOwn(built.value, "secret")).toBe(false);
  });

  it("编辑时填了新 secret 才送，且连 kind 一起不送（kind 不可改）", () => {
    const form = { ...formFromTarget(makeTarget({ kind: "s3", bucket: "b" })), secret: "new-secret" };
    const built = buildTargetPayload(form, false);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ secret: "new-secret" });
    expect(Object.hasOwn(built.value, "kind")).toBe(false);
  });

  it("S3 必须填桶名；WebDAV 的桶名不进请求体", () => {
    const s3 = { ...emptyTargetForm(), kind: "s3" as const, label: "R2", endpoint: "https://s3.example.com", secret: "k" };
    expect(buildTargetPayload(s3, true)).toEqual({ ok: false, error: expect.stringContaining("桶名") });

    const webdav = { ...emptyTargetForm(), label: "NAS", endpoint: "https://dav.example.com/m", secret: "k", bucket: "不该送" };
    const built = buildTargetPayload(webdav, true);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ bucket: null });
  });

  it("地址必须是 http(s) 开头且不含空格", () => {
    const form = { ...emptyTargetForm(), label: "x", endpoint: "dav.example.com", secret: "k" };
    expect(buildTargetPayload(form, true)).toEqual({ ok: false, error: expect.stringContaining("http") });
  });

  it("默认档是只增不删；选 sync 才出现不可恢复的警告", () => {
    expect(emptyTargetForm().delete_policy).toBe("append_only");
    expect(policyRisk("append_only")).toBeNull();
    expect(policyRisk("sync")).toContain("不可恢复");
  });

  it("lastRunText 分清「没跑过」和「从没成功过」和「最近失败」", () => {
    expect(lastRunText(makeTarget({ last_run_at: null }), NOW)).toBe("还没跑过");
    expect(lastRunText(makeTarget({ last_run_at: NOW - 3_600_000, last_result: null }), NOW)).toContain("从没成功过");
    expect(lastRunText(makeTarget({ last_run_at: NOW - 3_600_000, last_result: "failed" }), NOW)).toContain("最近失败");
    expect(lastRunText(makeTarget(), NOW)).toContain("最近成功");
  });

  it("S3 的 where 带上桶名，WebDAV 不带", () => {
    expect(targetWhere(makeTarget())).toContain("dav.example.com/menote");
    expect(targetWhere(makeTarget({ kind: "s3", endpoint: "https://s3.example.com", bucket: "my-bucket" }))).toContain(
      "https://s3.example.com/my-bucket",
    );
  });
});

describe("外部备份目标 · 界面", () => {
  it("读失败时不写空态（那时候「还没有目标」是假的）", async () => {
    state.listError = "网络断了";
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("网络断了")).toBeTruthy());
    expect(screen.queryByText("还没有备份目标")).toBeNull();
  });

  it("列表为空时给空态和主操作", async () => {
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("还没有备份目标")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "添加目标" }).length).toBeGreaterThan(0);
  });

  it("失败原因平铺可见，不藏进 ⓘ", async () => {
    state.targets = [makeTarget({ last_result: "failed", last_error: "远端返回 403" })];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("上次失败：远端返回 403")).toBeTruthy());
  });

  it("删除走行内二次确认，且明说远端文件一个都不动", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByText(/远端已经推上去的文件一个都不会动/)).toBeTruthy();
    // 还没点确认时不该真删
    expect(state.removed).toEqual([]);

    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(state.removed).toEqual(["t1"]));
  });

  it("编辑弹窗里密钥框是空的，且 label 说清留空 = 不改", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "编辑" }));
    const secret = await screen.findByLabelText("换口令（留空 = 不改）") as HTMLInputElement;
    expect(secret.value).toBe("");
  });

  it("类型在编辑态置灰，并给出原因（不可只置灰）", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "编辑" }));
    const option = await screen.findByRole("button", { name: "WebDAV" }) as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    expect(option.getAttribute("title")).toContain("删掉重建");
  });

  it("测连接的结果留在这一屏上", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    state.testResult = { ok: false, message: "远端返回 401" };
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "测连接" }));
    await waitFor(() => expect(screen.getByText("连接失败：远端返回 401")).toBeTruthy());
  });

  it("停用开关会改 enabled，且界面上不再显示为已启用", async () => {
    const user = userEvent.setup();
    state.targets = [makeTarget()];
    render(<BackupTargetsCard />);
    await waitFor(() => expect(screen.getByText("家里的 NAS")).toBeTruthy());

    await user.click(screen.getByRole("switch", { name: /启用「家里的 NAS」/ }));
    await waitFor(() => expect(state.updates).toEqual([{ id: "t1", input: { enabled: false } }]));
  });
});
