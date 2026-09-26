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
import { useNotesWorkspace } from "../features/notes/useNotesWorkspace";
import { changeLoginPassword } from "../features/settings/model";
import { SettingsPanel } from "../features/settings/ui/SettingsPanel";
import { AppShell } from "./AppShell";
import { FnBar } from "./fnbar/FnBar";
import { useRoute } from "./router";
import { useTheme } from "./theme/useTheme";
import { Topbar } from "./topbar/Topbar";
import { IconSprite } from "./ui/Icon";
import { ToastHost, pushToast } from "./ui/Toast";
import { toIndicator, type SyncEngineStatus } from "./useSyncStatus";

export default function App() {
  const { route, navigate } = useRoute();
  const auth = useAuth();
  const theme = useTheme();

  const [syncStatus, setSyncStatus] = useState<SyncEngineStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [registration, setRegistration] = useState<RegistrationState | null>(null);

  const engineRef = useRef<SyncEngine | null>(null);

  const refreshPending = useCallback(async () => {
    setPendingCount(await outboxCount());
  }, []);

  const workspace = useNotesWorkspace({
    onLocalWrite: () => {
      engineRef.current?.notifyLocalWrite();
      void refreshPending();
    },
  });

  const refreshAll = useCallback(async () => {
    await workspace.refresh();
    await refreshPending();
  }, [refreshPending, workspace]);

  // 登录后启动同步引擎：应用打开即同步一次，之后由引擎按触发时机自行推进
  useEffect(() => {
    if (auth.snapshot.status !== "authenticated") return undefined;

    const engine = createSyncEngine({
      onStatus: (status) => {
        setSyncStatus(status);
        if (status === "idle") void refreshAll();
      },
    });
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [auth.snapshot.status, refreshAll, refreshPending]);

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
        <div className="authpage">正在检查登录状态…</div>
      </>
    );
  }

  if (auth.snapshot.status === "anonymous") {
    return (
      <>
        <IconSprite />
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
      <IconSprite />
      <AppShell
        banner={
          syncStatus === "offline" ? (
            <div className="banner" role="status">
              离线，改动会在联网后上传
            </div>
          ) : null
        }
        topbar={
          <Topbar
            user={{ username: user.username, role: user.role }}
            breadcrumb={route.name === "settings" ? "设置" : "全部笔记"}
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
        ) : (
          <>
            <NoteList
              items={workspace.items}
              selectedId={workspace.selectedId}
              loading={workspace.loading}
              onSelect={(id) => {
                void workspace.open(id);
              }}
              onNewNote={() => {
                void workspace.createNote();
              }}
            />
            <NoteWorkspace
              item={workspace.selected}
              initialBody={workspace.initialBody}
              snapshot={workspace.snapshot}
              onInput={workspace.input}
              onTitleChange={(title) => {
                void workspace.changeTitle(title);
              }}
            />
          </>
        )}
      </AppShell>
      <ToastHost />
    </>
  );
}
