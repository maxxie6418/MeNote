// @vitest-environment jsdom
/**
 * UI 验收点测试（对应 `docs/modules/Menote-M1-界面稿-v1.md` 的逐屏结构）：
 * 顶栏块位、录入框占位与禁用说明、空状态出口、账户菜单、设置分类可见性、状态栏提示、登录页错误就地提示。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FnBar } from "../src/app/fnbar/FnBar";
import { Topbar } from "../src/app/topbar/Topbar";
import { InsecureContextBanner } from "../src/app/ui/InsecureContextBanner";
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { toIndicator } from "../src/app/useSyncStatus";
import { LoginPage } from "../src/features/auth/ui/LoginPage";
import { RegisterPage } from "../src/features/auth/ui/RegisterPage";
import { DocStatusBar } from "../src/features/notes/ui/DocStatusBar";
import { NoteList } from "../src/features/notes/ui/NoteList";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

function note(id: string, overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1_700_000_000_000,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...overrides,
  };
}

describe("顶栏块位（DESIGN.md §2.5-1）", () => {
  it("品牌 / 面包屑 / 搜索框 / 同步胶囊 / 账户入口 都在位；未启用隐私锁时不渲染隐私胶囊", () => {
    render(
      <Topbar
        user={{ username: "alice", role: "owner" }}
        breadcrumb="全部笔记"
        sync={toIndicator("idle", 0)}
        searchQuery=""
        onSearchChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    const topbar = screen.getByRole("banner");
    expect(within(topbar).getByText("Menote")).toBeTruthy();
    expect(within(topbar).getByText("全部笔记")).toBeTruthy();

    // 搜索框：M2-6 起可用（不再是禁用占位）
    const search = within(topbar).getByLabelText("搜索") as HTMLInputElement;
    expect(search.disabled).toBe(false);
    expect(search.placeholder).toContain("搜索标题");

    expect(within(topbar).getByText("已同步")).toBeTruthy();
    expect(within(topbar).getByRole("button", { name: "账户与设置" })).toBeTruthy();

    // 隐私锁胶囊：未启用隐私锁时不显示（拆解 M02-05）
    expect(within(topbar).queryByText(/隐私/)).toBeNull();
  });

  it("账户菜单里有「设置」与「退出登录」，Esc 关闭", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onLogout = vi.fn();

    render(
      <Topbar
        user={{ username: "alice", role: "owner" }}
        breadcrumb="全部笔记"
        sync={toIndicator("idle", 0)}
        searchQuery=""
        onSearchChange={vi.fn()}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />,
    );

    const trigger = screen.getByRole("button", { name: "账户与设置" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu", { name: "账户与设置" });
    await user.click(within(menu).getByRole("menuitem", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("同步胶囊按队列与离线状态换文案", () => {
    expect(toIndicator("idle", 0)).toMatchObject({ tone: "ok", label: "已同步" });
    expect(toIndicator("syncing", 3)).toMatchObject({ tone: "busy", label: "3 项待上传" });
    expect(toIndicator("offline", 0)).toMatchObject({
      tone: "busy",
      label: "离线，改动会在联网后上传",
    });
    expect(toIndicator("error", 0)).toMatchObject({ tone: "err", label: "同步失败" });
  });
});

describe("功能栏与录入框占位", () => {
  it("三档模式可切换、附加项容器恒在、发布按钮禁用且说明原因", async () => {
    const user = userEvent.setup();
    render(
      <FnBar
        onNewNote={vi.fn()}
        onPublishNote={vi.fn()}
        onPublishMemo={vi.fn()}
        onPublishTask={vi.fn()}
        view={{ kind: "notebook" }}
        onViewChange={vi.fn()}
        notebookPanel={null}
        tags={[]}
      />,
    );

    // 结构不变量：新建按钮 + 录入框三行
    expect(screen.getByRole("button", { name: /新建笔记/ })).toBeTruthy();
    const input = screen.getByLabelText("快速录入");
    expect(input).toBeTruthy();

    const extras = screen.getByTestId("composer-extras");
    expect(extras).toBeTruthy();

    const memo = screen.getByRole("button", { name: "Memo" });
    const task = screen.getByRole("button", { name: "待办" });
    const noteMode = screen.getByRole("button", { name: "笔记" });

    expect(memo.getAttribute("aria-pressed")).toBe("true");
    expect(extras.textContent).toBe(""); // memo 模式：空容器占位，不塌陷

    await user.click(task);
    expect(task.getAttribute("aria-pressed")).toBe("true");
    expect(extras.textContent).toContain("截止");

    await user.click(noteMode);
    expect(extras.textContent).toContain("首行作标题");

    // 容器始终存在（切换模式不换高度靠 CSS 固定 26px，这里断言容器没被移除）
    expect(screen.getByTestId("composer-extras")).toBeTruthy();

    // 笔记档已可用：禁用原因是"还没写内容"，不再是"M2 未提供"
    const publish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(publish.title).toContain("先写点内容");

    // Memo 档也已可用（M2-4）：同样只是"还没写内容"
    await user.click(screen.getByRole("button", { name: "Memo" }));
    const memoPublish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(memoPublish.disabled).toBe(true);
    expect(memoPublish.title).toContain("先写点内容");

    // 三档都已可用（Memo M2-4 / 待办 M2-5）：空内容时的禁用原因都是"还没写内容"
    await user.click(screen.getByRole("button", { name: "待办" }));
    const taskPublish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(taskPublish.disabled).toBe(true);
    expect(taskPublish.title).toContain("先写点内容");
    expect(screen.getByLabelText("截止日期")).toBeTruthy();
  });
});

describe("笔记列表空状态", () => {
  it("没有笔记时给出原因与出口按钮", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    render(
      <NoteList
        items={[]}
        title="全部笔记"
        selectedId={null}
        loading={false}
        onSelect={vi.fn()}
        onNewNote={onNewNote}
      />,
    );

    expect(screen.getByText("还没有笔记")).toBeTruthy();
    expect(screen.getByText(/联网后自动上传/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /新建笔记/ }));
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });

  it("列出条目并在行内显示待上传标记", () => {
    render(
      <NoteList
        items={[note("a"), note("b", { pending: "save_body" })]}
        title="全部笔记"
        selectedId="a"
        loading={false}
        onSelect={vi.fn()}
        onNewNote={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("待上传")).toBeTruthy();
    expect(screen.getByRole("button", { current: true }).textContent).toContain("标题 a");
  });
});

describe("正文状态栏（M04-04/M04-05）", () => {
  it("硬上限提示与阻止态可见；正常时显示大小与已同步", () => {
    const { rerender } = render(
      <DocStatusBar
        snapshot={{ bytes: 0, sizeLabel: "0.0 MB / 2 MB", sizeLevel: "ok", saveState: "synced" }}
      />,
    );
    expect(screen.getByText("0.0 MB / 2 MB")).toBeTruthy();
    expect(screen.getByText("已同步")).toBeTruthy();

    rerender(
      <DocStatusBar
        snapshot={{
          bytes: 1_900_000,
          sizeLabel: "1.8 MB / 2 MB",
          sizeLevel: "hard",
          saveState: "blocked",
        }}
      />,
    );
    // 破坏性后果必须保持可见，不能收进 InfoHint（DESIGN.md 禁止项 #8）
    expect(screen.getByText("已达硬上限，无法继续保存，请拆分内容")).toBeTruthy();
    expect(screen.getByText("已达硬上限")).toBeTruthy();

    rerender(
      <DocStatusBar
        snapshot={{ bytes: 40, sizeLabel: "0.0 MB / 2 MB", sizeLevel: "ok", saveState: "failed" }}
      />,
    );
    expect(screen.getByText("上传失败")).toBeTruthy();
  });
});

describe("登录与注册页", () => {
  it("登录失败就地提示（不弹窗）；注册入口按开关显隐", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => {
      throw new Error("用户名或密码错误");
    });

    const { rerender } = render(
      <LoginPage onLogin={onLogin} onGoRegister={vi.fn()} showRegisterEntry={false} />,
    );
    expect(screen.queryByRole("button", { name: /注册/ })).toBeNull();

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("登录密码"), "pw");
    await user.click(screen.getByRole("button", { name: "登录" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("用户名或密码错误");

    rerender(<LoginPage onLogin={onLogin} onGoRegister={vi.fn()} showRegisterEntry />);
    expect(screen.getByRole("button", { name: /还没有账号？注册/ })).toBeTruthy();
  });

  it("注册页：两次密码不一致时就地提示且不能提交；首位用户显示 owner 提示", async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn(async () => undefined);
    render(<RegisterPage onRegister={onRegister} onGoLogin={vi.fn()} firstUser />);

    expect(screen.getByText(/第一个注册的账号将成为管理员/)).toBeTruthy();

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("登录密码"), "pw1");
    await user.type(screen.getByLabelText("再输一次登录密码"), "pw2");

    const submit = screen.getByRole("button", { name: "注册" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("两次输入的密码不一致")).toBeTruthy();
    expect(onRegister).not.toHaveBeenCalled();
  });
});

describe("设置壳", () => {
  const baseProps = {
    role: "owner" as const,
    themeMode: "light" as const,
    onThemeMode: vi.fn(),
    userSettings: DEFAULT_USER_SETTINGS,
    onPatchSettings: vi.fn(),
    registrationOpen: false,
    onToggleRegistration: vi.fn(async () => undefined),
    onChangePassword: vi.fn(async () => undefined),
    onLogout: vi.fn(),
    onNavigate: vi.fn(),
  };

  it("owner 能看到 M2 已实现的分类；通用页有主题三档且当前档被选中", () => {
    render(<SettingsPanel {...baseProps} page="general" />);

    const nav = screen.getByRole("navigation", { name: "设置分类" });
    for (const label of ["通用", "账户与安全", "编辑器", "隐私锁", "版本与回收站", "实例管理"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    // 未实现的分类不进导航（避免点进去空页面）
    expect(within(nav).queryByRole("button", { name: "备份" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "MCP" })).toBeNull();

    const light = screen.getByRole("button", { name: "浅色" });
    expect(light.getAttribute("aria-pressed")).toBe("true");
  });

  it("通用页：启动视图与快捷菜单开关都会即时回调", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(<SettingsPanel {...baseProps} page="general" onPatchSettings={onPatchSettings} />);

    await user.click(screen.getByRole("button", { name: "最近编辑" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ start_view: "recent" });

    // 快捷菜单：默认关着的「搜索」点一下变开启
    await user.click(screen.getByRole("switch", { name: "搜索" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ quick_menu: ["theme", "lock", "search"] });
  });

  it("编辑器页：三档可选，第四档「即时渲染」置灰并说明原因", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(<SettingsPanel {...baseProps} page="editor" onPatchSettings={onPatchSettings} />);

    await user.click(screen.getByRole("button", { name: "仅预览" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ editor_mode: "preview" });

    const instant = screen.getByRole("button", { name: "即时渲染" }) as HTMLButtonElement;
    expect(instant.disabled).toBe(true);
    expect(instant.title).toContain("M2");
  });

  it("member 看不到实例管理；切换注册开关会回调", async () => {
    const user = userEvent.setup();
    const onToggleRegistration = vi.fn(async () => undefined);

    const { rerender } = render(<SettingsPanel {...baseProps} page="general" role="member" />);
    expect(screen.queryByRole("button", { name: "实例管理" })).toBeNull();

    rerender(
      <SettingsPanel
        {...baseProps}
        page="instance"
        role="owner"
        onToggleRegistration={onToggleRegistration}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "允许新用户注册" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await user.click(toggle);
    expect(onToggleRegistration).toHaveBeenCalledWith(true);
  });

  it("账户与安全页：改密表单与退出登录都在", () => {
    render(<SettingsPanel {...baseProps} page="account" />);
    expect(screen.getByLabelText("当前登录密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "修改登录密码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
  });
});

describe("非安全连接的常驻警告", () => {
  it("给出可行动的解释，并把观测到的事实一并显示", () => {
    const { rerender } = render(
      <InsecureContextBanner
        environment={{
          secure: false,
          protocol: "http:",
          href: "http://me.example/app",
          hasSubtle: false,
          reason: "页面是用 http 打开的。请改用 https 访问。",
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("https");
    expect(alert.textContent).toContain("无法登录");

    rerender(<InsecureContextBanner secure />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("可点元素键盘可达", () => {
  it("列表行是原生 button（可用 Enter 触发）", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <NoteList
        items={[note("a")]}
        title="全部笔记"
        selectedId={null}
        loading={false}
        onSelect={onSelect}
        onNewNote={vi.fn()}
      />,
    );

    // 行本身是 button（行内还有"更多操作"按钮，所以按 class 取行）
    const row = container.querySelector(".itemrow") as HTMLElement;
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
