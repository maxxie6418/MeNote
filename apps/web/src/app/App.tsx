/**
 * 组合根（架构 §2.3.1：入口 `main.tsx` 只做装配，这里负责把各层接起来）。
 *
 * 分工：认证状态 → `features/auth`；本地数据与自动保存 → `features/notes`；
 * 网络与冲突 → `data/sync`；界面骨架 → `app/`。业务判断不写在 JSX 里。
 */
import type { RegistrationState } from "@menote/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "../data/api/endpoints";
import { outboxCount } from "../data/db";
import { createSyncEngine, type SyncEngine } from "../data/sync";
import { LoginPage } from "../features/auth/ui/LoginPage";
import { RegisterPage } from "../features/auth/ui/RegisterPage";
import { useAuth } from "../features/auth/model";
import { NoteList } from "../features/notes/ui/NoteList";
import { NoteWorkspace } from "../features/notes/ui/NoteWorkspace";
import { NotebookPanel } from "../features/notes/ui/NotebookPanel";
import { useNotesWorkspace } from "../features/notes/useNotesWorkspace";
import { changeLoginPassword } from "../features/settings/model";
import { SettingsPanel } from "../features/settings/ui/SettingsPanel";
import { useUserSettings } from "../features/settings/useUserSettings";
import type { UserSettings } from "@menote/shared";
import { AppShell } from "./AppShell";
import { FnBar } from "./fnbar/FnBar";
import type { ComposerMode } from "./fnbar/Composer";
import type { BrowsableView } from "./fnbar/NavSegmented";
import { useRoute } from "./router";
import { useTheme } from "./theme/useTheme";
import { Topbar } from "./topbar/Topbar";
import { IconSprite } from "./ui/Icon";
import { InsecureContextBanner } from "./ui/InsecureContextBanner";
import { inspectCryptoEnvironment, type CryptoEnvironment } from "./ui/cryptoEnvironment";
import { ToastHost, pushToast } from "./ui/Toast";
import { toIndicator, type SyncEngineStatus } from "./useSyncStatus";
import { TwoPane } from "./workarea/TwoPane";
import { HomeView } from "./workarea/HomeView";
import { SearchView } from "./workarea/SearchView";
import { MemoPanel } from "../features/memos/ui/MemoPanel";
import { convertMemoToNote } from "../features/memos/actions";
import { TaskPanel } from "../features/tasks/ui/TaskPanel";
import { clearTaskMarker, setTaskStatus } from "../features/tasks/actions";
import { taskTitle } from "../features/tasks/model";
import { dayKeyInZone } from "../features/memos/model";
import { useSearch } from "../features/search/useSearch";
import type { NotesView } from "../features/notes/views";

export default function App() {
  const { route, navigate } = useRoute();
  const auth = useAuth();
  const theme = useTheme();

  const [syncStatus, setSyncStatus] = useState<SyncEngineStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  /**
   * 浏览三段（首页 / Memo / 待办）的当前项；`null` = 停留在笔记视图。
   * 笔记侧的任何导航（最近编辑 / 收藏 / 笔记本 / 标签）都会把它重置回 `null`。
   */
  const [browse, setBrowse] = useState<BrowsableView | null>(null);
  /** 录入框模式（受控）：首页的「记录 Memo / 新建待办」会切档（M2-8） */
  const [composerMode, setComposerMode] = useState<ComposerMode>("memo");

  /**
   * 加密能力环境只在挂载时探一次：它会决定"能不能登录/保存"，而浏览器在会话中途改变
   * 安全上下文的情况极罕见；探一次可以避免每次渲染都读 location。
   */
  const insecureEnvironment: CryptoEnvironment | null = (() => {
    const env = inspectCryptoEnvironment();
    return env.secure && env.hasSubtle ? null : env;
  })();

  const engineRef = useRef<SyncEngine | null>(null);
  /** 跨标签页刷新是否正在跑（合并连发事件，避免刷新风暴） */
  const remoteRefreshRunning = useRef(false);

  const refreshPending = useCallback(async () => {
    setPendingCount(await outboxCount());
  }, []);

  const workspace = useNotesWorkspace({
    onLocalWrite: () => {
      engineRef.current?.notifyLocalWrite();
      void refreshPending();
    },
  });

  /**
   * 依赖里带上 `workspace` 是安全的：启动同步引擎的 effect **只依赖登录状态**，
   * 回调经 `refreshAllRef` 间接调用，所以这个 callback 换身份不会重建引擎。
   */
  const refreshAll = useCallback(async () => {
    await workspace.refresh();
    await workspace.refreshEditorState();
    await refreshPending();
  }, [refreshPending, workspace]);

  /** 切换笔记视图时同时退出浏览三段，避免"看起来在 Memo 页、却在改笔记视图" */
  const showNotesView = useCallback(
    (view: NotesView) => {
      setBrowse(null);
      workspace.setView(view);
    },
    [workspace],
  );

  /** 「添加」按钮：把焦点送回功能栏的录入框（M07-01 入口二） */
  const focusComposer = useCallback(() => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="快速录入"]');
    input?.focus();
    input?.scrollIntoView({ block: "nearest" });
  }, []);

  /**
   * 搜索（M2-6）：整段接线在 `useSearch` 里（查询、筛选、本地检索、索引未建完时的服务端回退）。
   * 它**不改浏览视图状态**——所以清空搜索框就自然回到进入搜索前的视图。
   */
  const search = useSearch({ items: workspace.allItems, memos: workspace.memos });

  /**
   * 跟随账号同步的设置（M2-7）：即时生效 + 入队上传；写完后叫醒同步引擎。
   * 放在"今天"之前：待办视图的日期口径要用它的时区。
   *
   * `onLoaded` 里应用**启动视图**（M2-8）：设置是异步从本地库读出来的，所以在读到的这一刻
   * 决定进入哪个视图；只在首次读盘时生效一次，之后用户的导航不再被覆盖。
   */
  const startViewApplied = useRef(false);

  const userSettings = useUserSettings({
    onWrite: () => {
      engineRef.current?.notifyLocalWrite();
      void refreshPending();
    },
    onLoaded: (loaded) => {
      if (startViewApplied.current) return;
      startViewApplied.current = true;

      if (loaded.start_view === "home") {
        setBrowse("home");
        return;
      }
      setBrowse(null);
      workspace.setView(loaded.start_view === "starred" ? { kind: "starred" } : { kind: "recent" });
    },
  });
  const patchSettings = useCallback(
    (partial: Partial<UserSettings>) => {
      void userSettings.patch(partial);
    },
    [userSettings],
  );

  /** 待办视图的"今天"：按**用户设置的时区**算，且只在挂载时取一次（渲染期调 Date.now() 不纯） */
  const [today] = useState(() => dayKeyInZone(Date.now(), userSettings.settings.timezone));

  // Ctrl/Cmd+K 聚焦顶栏搜索（M2-6）；输入框用固定 id 定位，避免为一处焦点穿透多个组件
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("search-input")?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * 同步引擎必须**只随登录状态**创建/销毁。
   *
   * 踩过的坑（M1-11 实测：10 秒 35 次 `GET /api/sync`）：把 `refreshAll` 直接放进下面的依赖数组，
   * 而 `refreshAll` 会 `setItems(...)` 写入新数组 → 重渲染 → 依赖身份变化 → effect 重跑 →
   * 引擎被 stop/create/start → 立刻又跑一轮 → 再来一次。改用 ref 持有回调，依赖只留登录状态。
   */
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);

  // 登录后启动同步引擎：应用打开即同步一次，之后由引擎按触发时机自行推进
  useEffect(() => {
    if (auth.snapshot.status !== "authenticated") return undefined;

    const engine = createSyncEngine({
      onStatus: (status) => {
        setSyncStatus(status);
        // 失败要看得见：被 void 掉的 rejected promise 会让状态永远停在旧值（M1-11 踩过）
        if (status === "idle") {
          void refreshAllRef.current().catch((error: unknown) => {
            console.error("同步后刷新界面状态失败", error);
          });
        }
      },
      /**
       * 别的标签页写入/同步完（M2-9）：本页**只重读本地库**，不再跑一轮同步——数据已经在本地
       * 库里了，省掉一次网络往返。用 in-flight 标记合并连发事件，避免多标签页同时活动时刷新风暴。
       */
      onRemoteChange: () => {
        if (remoteRefreshRunning.current) return;
        remoteRefreshRunning.current = true;
        void refreshAllRef
          .current()
          .catch((error: unknown) => {
            console.error("跨标签页刷新失败", error);
          })
          .finally(() => {
            remoteRefreshRunning.current = false;
          });
      },
    });
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [auth.snapshot.status]);

  // 未登录一律回登录页；库中还没有用户时直接回注册页（拆解 M01-01）
  useEffect(() => {
    if (auth.snapshot.status === "loading") return;

    if (auth.snapshot.status === "anonymous") {
      if (route.name !== "login" && route.name !== "register") {
        navigate(auth.snapshot.hasUsers ? { name: "login" } : { name: "register" });
      }
      return;
    }
    if (route.name === "login" || route.name === "register") {
      navigate({ name: "notes" });
    }
  }, [auth.snapshot, navigate, route.name]);

  // 进入设置页时读实例级注册开关（仅 owner 有权限）
  useEffect(() => {
    if (route.name !== "settings" || auth.snapshot.user?.role !== "owner") return;
    void adminApi
      .getRegistration()
      .then(setRegistration)
      .catch(() => setRegistration(null));
  }, [route, auth.snapshot.user?.role]);

  if (auth.snapshot.status === "loading") {
    return (
      <>
        <IconSprite />
        <InsecureContextBanner />
        <div className="authpage">正在检查登录状态…</div>
      </>
    );
  }

  if (auth.snapshot.status === "anonymous") {
    return (
      <>
        <IconSprite />
        <InsecureContextBanner />
        {route.name === "register" ? (
          <RegisterPage
            firstUser={!auth.snapshot.hasUsers}
            onRegister={async (username, password) => {
              await auth.register(username, password);
              navigate({ name: "notes" });
            }}
            onGoLogin={() => navigate({ name: "login" })}
          />
        ) : (
          <LoginPage
            showRegisterEntry={auth.snapshot.registrationOpen || !auth.snapshot.hasUsers}
            onLogin={async (username, password) => {
              await auth.login(username, password);
              navigate({ name: "notes" });
            }}
            onGoRegister={() => navigate({ name: "register" })}
          />
        )}
        <ToastHost />
      </>
    );
  }

  const user = auth.snapshot.user;
  if (!user) return null;

  const sync = toIndicator(syncStatus, pendingCount);

  return (
    <>
      <IconSprite />      <AppShell
        banner={
          insecureEnvironment ? (
            <InsecureContextBanner environment={insecureEnvironment} />
          ) : syncStatus === "offline" ? (
            <div className="banner" role="status">
              离线，改动会在联网后上传
            </div>
          ) : null
        }
        topbar={
          <Topbar
            user={{ username: user.username, role: user.role }}
            breadcrumb={
              route.name === "settings"
                ? "设置"
                : search.query.trim() !== ""
                  ? "搜索结果"
                  : browse === "memo"
                    ? "Memo"
                    : browse === "task"
                      ? "待办"
                      : workspace.viewTitle
            }
            searchQuery={search.query}
            onSearchChange={search.setQuery}
            userSettings={userSettings.settings}
            themeMode={theme.mode}
            onThemeMode={theme.setMode}
            onFocusSearch={() => {
              document.getElementById("search-input")?.focus();
            }}
            sync={sync}
            onOpenSettings={() => navigate({ name: "settings", page: "general" })}
            onLogout={() => {
              void auth.logout().then(() => navigate({ name: "login" }));
            }}
          />
        }
        fnbar={
          <FnBar
            onNewNote={() => {
              void workspace.createNote();
            }}
            onPublishNote={(title, body) => {
              void workspace.createNote({ title, body });
              pushToast("已新建笔记", "success");
            }}
            onPublishMemo={(text, options) => {
              // 乐观发布：条目先落本地并标"待上传"，由 outbox 后台上传
              void workspace.publishMemo(text, options);
              pushToast("已记录", "success");
            }}
            onPublishTask={(text, options) => {
              void workspace.publishMemo(text, { asTask: true, ...options });
              pushToast("已加入待办", "success");
            }}
            view={workspace.view}
            onViewChange={showNotesView}
            tags={workspace.tags}
            browseView={browse ?? undefined}
            onBrowseChange={(next) => setBrowse(next)}
            showHome={userSettings.settings.start_view === "home"}
            composerMode={composerMode}
            onComposerModeChange={setComposerMode}
            notebookPanel={
              <NotebookPanel
                view={workspace.view}
                onViewChange={showNotesView}
                folders={workspace.folders}
                counts={workspace.folderCounts}
                onCreateFolder={workspace.createFolder}
                onRenameFolder={workspace.renameFolder}
                onMoveFolder={workspace.moveFolder}
              />
            }
          />
        }
      >
        {route.name === "settings" ? (
          <SettingsPanel
            page={route.page}
            onNavigate={(page) => navigate({ name: "settings", page })}
            role={user.role}
            themeMode={theme.mode}
            onThemeMode={theme.setMode}
            userSettings={userSettings.settings}
            onPatchSettings={patchSettings}
            registrationOpen={registration?.open ?? false}
            onToggleRegistration={async (open) => {
              const next = await adminApi.setRegistration(open);
              setRegistration(next);
              pushToast(open ? "已开放注册" : "已关闭注册", "success");
            }}
            onChangePassword={async (current, next) => {
              const result = await changeLoginPassword(user.username, current, next);
              pushToast(
                result.invalidatedSessions > 0
                  ? `登录密码已修改；已使 ${result.invalidatedSessions} 个其他设备会话失效`
                  : "登录密码已修改",
                "success",
              );
            }}
            onLogout={() => {
              void auth.logout().then(() => navigate({ name: "login" }));
            }}
          />
        ) : search.query.trim() !== "" ? (
          <SearchView
            query={search.query.trim()}
            results={search.results}
            folderNames={Object.fromEntries(
              workspace.folders.map((folder) => [folder.id, folder.name]),
            )}
            filters={search.filters}
            onFiltersChange={search.setFilters}
            tags={search.tags}
            staleNotice={search.stale ? "正在建立本地索引，当前结果可能不完整。" : undefined}
            onOpen={(id) => {
              search.clear();
              void workspace.open(id);
            }}
            onClose={search.clear}
          />
        ) : browse === "home" ? (
          /* 首页（M2-8）：数据全部由本地元数据算，不发额外请求 */
          <HomeView
            items={workspace.allItems}
            memos={workspace.memos}
            folders={workspace.folders.map((folder) => ({ id: folder.id, name: folder.name }))}
            titles={Object.fromEntries(
              Object.entries(workspace.memoContents).map(([id, entry]) => [
                id,
                taskTitle(entry.content),
              ]),
            )}
            onNewNote={() => {
              void workspace.createNote();
            }}
            onFocusComposer={(mode) => {
              setComposerMode(mode);
              focusComposer();
            }}
            onFocusSearch={() => {
              document.getElementById("search-input")?.focus();
            }}
            onOpenItem={(id) => {
              setBrowse(null);
              void workspace.open(id);
            }}
            onOpenView={(view) => {
              if (view === "memo" || view === "task") {
                setBrowse(view);
                return;
              }
              setBrowse(null);
              workspace.setView(
                view === "recent"
                  ? { kind: "recent" }
                  : view === "starred"
                    ? { kind: "starred" }
                    : { kind: "notebook" },
              );
            }}
            onOpenFolder={(folderId) => {
              setBrowse(null);
              workspace.setView({ kind: "notebook", folderId });
            }}
            onOpenTag={(tag) => {
              setBrowse(null);
              workspace.setView({ kind: "tag", tag });
            }}
          />
        ) : browse === "task" ? (
          /* 待办视图：单栏占满（列表 / 看板由面板内部切换） */
          <TwoPane
            listHidden={true}
            list={null}
            doc={
              <TaskPanel
                tasks={workspace.memos.filter((memo) => memo.is_task === 1)}
                titles={Object.fromEntries(
                  Object.entries(workspace.memoContents).map(([id, entry]) => [
                    id,
                    taskTitle(entry.content),
                  ]),
                )}
                today={today}
                onStatusChange={(id, status) => {
                  void setTaskStatus(id, status).then(() => workspace.refresh());
                }}                onClearMarker={(id) => {
                  void clearTaskMarker(id).then(() => workspace.refresh());
                }}
              />
            }
          />
        ) : browse === "memo" ? (
          /* Memo 视图：单栏占满（时间轴），列表让位 */
          <TwoPane
            listHidden={true}
            list={null}
            doc={
              <MemoPanel
                memos={workspace.memos}
                contents={workspace.memoContents}
                timeZone={userSettings.settings.timezone}
                onSave={(id, text) => {
                  void workspace.updateMemo(id, text);
                }}
                onTogglePinned={(id) => {
                  void workspace.togglePinned(id);
                }}
                onConvert={(id) => {
                  void convertMemoToNote(id).then(async (noteId) => {
                    // Q10：新笔记直接打开 —— 回到笔记视图并打开它
                    setBrowse(null);
                    await workspace.refresh();
                    await workspace.open(noteId);
                    pushToast("已转为笔记", "success");
                  });
                }}
                onOpenConverted={(noteId) => {
                  setBrowse(null);
                  void workspace.open(noteId);
                }}
                onAdd={focusComposer}
              />
            }
          />
        ) : (
          <TwoPane
            list={
              <NoteList
                items={workspace.items}
                title={workspace.viewTitle}
                selectedId={workspace.selectedId}
                loading={workspace.loading}
                summaries={workspace.summaries}
                folders={workspace.folders}
                onSelect={(id) => {
                  void workspace.open(id);
                }}
                onNewNote={() => {
                  void workspace.createNote();
                }}
                onMove={(id, folderId) => {
                  void workspace.moveItemToFolder(id, folderId);
                }}
                onTogglePinned={(id) => {
                  void workspace.togglePinned(id);
                }}
                onToggleStarred={(id) => {
                  void workspace.toggleStarred(id);
                }}
              />
            }
            doc={
              /* key 用条目 id：切换条目必须重挂载正文区，否则新条目会沿用上一篇的文本 */
              <NoteWorkspace
                key={workspace.selectedId ?? "none"}
                item={workspace.selected}
                initialBody={workspace.initialBody}
                snapshot={workspace.snapshot}
                initialMode={userSettings.settings.editor_mode}
                onInput={workspace.input}
                onTitleChange={(title) => {
                  void workspace.changeTitle(title);
                }}
              />
            }
          />
        )}
      </AppShell>
      <ToastHost />
    </>
  );
}
