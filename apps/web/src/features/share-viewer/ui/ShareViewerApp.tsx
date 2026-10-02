/**
 * 分享查看器根组件（M5-S3；架构 §十；《M5 分享设计》§四-S3）。
 *
 * 四态：加载中 → 链接已失效 / 要密码 → 内容。访客只能看：
 * 正文按 Markdown 呈现（markdown-it + DOMPurify，与主应用同一套渲染层），
 * 表格按只读网格呈现并可在有图片时切图册（Q18 定稿：不提供筛选与排序）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseTableDocument } from "@menote/mdcore";
import type { ShareContent } from "@menote/shared";
import { MarkdownPreview } from "../../../app/editor/MarkdownPreview";
import {
  fetchShareContent,
  fetchShareStatus,
  loadAttachmentBlobs,
  parseShareId,
  unlockShare,
} from "../model";

type Stage =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "password"; salt: string; iterations: number; error: string | null; busy: boolean }
  | { kind: "content"; content: ShareContent; body: string; images: string[]; view: "table" | "gallery" }
  | { kind: "error"; message: string };

export function ShareViewerApp() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [password, setPassword] = useState("");
  // 惰性求值（不在模块顶层）：测试与将来的同页复用都在挂载后才确定路径
  const sid = useMemo(() => parseShareId(window.location.pathname), []);

  const loadContent = useCallback(
    (token: string): void => {
      if (!sid) {
        setStage({ kind: "invalid" });
        return;
      }
      void (async () => {
        try {
          const content = await fetchShareContent(sid, token);
          const { body, blobs } = await loadAttachmentBlobs(sid, token, content.item.body);
          setStage({
            kind: "content",
            content,
            body,
            images: [...blobs.urls.values()],
            view: "table",
          });
        } catch (cause) {
          setStage({
            kind: "error",
            message: cause instanceof Error ? cause.message : "无法读取分享内容",
          });
        }
      })();
    },
    [sid],
  );

  useEffect(() => {
    // 路径不合法在**渲染期**就返回失效页（见本组件末尾），effect 里只处理有效链接——
    // effect 里同步 setState 会触发级联渲染（react-hooks/set-state-in-effect）
    let alive = true;
    void (async () => {
      if (!sid) return;
      try {
        const status = await fetchShareStatus(sid);
        if (!alive) return;
        if (status.status === "invalid") {
          setStage({ kind: "invalid" });
          return;
        }
        if (!status.requires_password) {
          // 无密码：仍走一次 unlock 拿访问令牌（无密码的 unlock 直接发令牌，架构 §十）
          const unlocked = await unlockShare(sid);
          if (!alive) return;
          if (unlocked.status === "ok" && unlocked.token) {
            loadContent(unlocked.token);
            return;
          }
          setStage({ kind: "invalid" });
          return;
        }
        setStage({
          kind: "password",
          salt: status.salt ?? "",
          iterations: status.kdf?.iterations ?? 0,
          error: null,
          busy: false,
        });
      } catch (cause) {
        if (!alive) return;
        setStage({
          kind: "error",
          message: cause instanceof Error ? cause.message : "无法读取分享状态",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadContent, sid]);

  async function submitPassword(): Promise<void> {
    if (!sid) return;
    setStage((prev) => (prev.kind === "password" ? { ...prev, busy: true, error: null } : prev));
    try {
      const { deriveSharePasswordMaterial } = await import("../../shares/model");
      const material = await deriveSharePasswordMaterial(password);
      const unlocked = await unlockShare(sid, material.verifier);
      if (unlocked.status === "ok" && unlocked.token) {
        loadContent(unlocked.token);
        return;
      }
      setStage((prev) =>
        prev.kind === "password"
          ? {
              ...prev,
              busy: false,
              error: unlocked.status === "wrong_password" ? "密码不对" : "链接已失效",
            }
          : prev,
      );
    } catch {
      setStage((prev) =>
        prev.kind === "password" ? { ...prev, busy: false, error: "无法验证密码" } : prev,
      );
    }
  }

  // 路径不像分享链接（主应用路径被误当查看器打开等）：渲染期直接给失效页，不进状态机
  if (sid === null) {
    return (
      <main className="viewer">
        <h1 className="viewer__title">链接已失效</h1>
        <p className="viewer__note">分享链接的格式不对，请向分享者确认完整链接。</p>
      </main>
    );
  }

  if (stage.kind === "loading") {
    return <main className="viewer"><p className="viewer__note">正在打开…</p></main>;
  }
  if (stage.kind === "invalid") {
    return (
      <main className="viewer">
        <h1 className="viewer__title">链接已失效</h1>
        <p className="viewer__note">链接可能已撤销、已过期，或这篇内容已被删除、加密。</p>
      </main>
    );
  }
  if (stage.kind === "error") {
    return (
      <main className="viewer">
        <h1 className="viewer__title">打不开</h1>
        <p className="viewer__note">{stage.message}</p>
      </main>
    );
  }
  if (stage.kind === "password") {
    return (
      <main className="viewer">
        <h1 className="viewer__title">这条分享需要密码</h1>
        <label className="field">
          <span>访问密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
          />
        </label>
        {stage.error !== null ? (
          <p className="viewer__error" role="alert">
            {stage.error}
          </p>
        ) : null}
        <button type="button" className="btn" disabled={stage.busy} onClick={() => void submitPassword()}>
          {stage.busy ? "验证中…" : "打开"}
        </button>
      </main>
    );
  }

  const { content, body, images, view } = stage;
  const table = content.item.type === "table" ? parseTableDocument(content.item.body) : null;
  const showTable = table !== null && table.ok;

  return (
    <main className="viewer">
      {content.item.title !== null ? (
        <h1 className="viewer__title">{content.item.title}</h1>
      ) : null}
      {showTable && images.length > 0 ? (
        <div className="segmented viewer__switch" role="group" aria-label="视图">
          <button
            type="button"
            className="segmented__item"
            aria-pressed={view === "table"}
            onClick={() => setStage({ ...stage, view: "table" })}
          >
            表格
          </button>
          <button
            type="button"
            className="segmented__item"
            aria-pressed={view === "gallery"}
            onClick={() => setStage({ ...stage, view: "gallery" })}
          >
            图册
          </button>
        </div>
      ) : null}

      {showTable && view === "table" ? (
        <table className="viewer__table">
          <thead>
            <tr>
              {table.doc.columns.map((column) => (
                <th key={column.id}>{column.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.doc.rows.map((row) => (
              <tr key={String(row[table.doc.rowIdColumn] ?? "")}>
                {table.doc.columns.map((column) => (
                  <td key={column.id}>{row[column.id] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : showTable && view === "gallery" ? (
        <div className="viewer__gallery">
          {images.map((url) => (
            <img key={url} src={url} alt="" loading="lazy" />
          ))}
        </div>
      ) : (
        <MarkdownPreview source={body} allowBlobUris />
      )}
    </main>
  );
}
