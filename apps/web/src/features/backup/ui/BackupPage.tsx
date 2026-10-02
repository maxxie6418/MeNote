/**
 * 设置 › 备份与导出（M5）。
 *
 * 两件事，一件是安全的（导出），一件是危险的（导入会往库里写）。所以：
 * - **导出**不需要确认，但全程要有**可见进度与可中断**（`DESIGN.md` §5.4-3 / §6.1）；
 * - **导入**先出「这份备份里有什么」的摘要，**再**弹二次确认，理由与影响条数写全
 *   （`DESIGN.md` §5.1-2：多步危险流程要有明确入口与退出方式）。
 *
 * 说明性文字一律收进 `InfoHint`（§5.4-1），只有进度、结果、错误这类**实时状态**平铺。
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { exportBackup, type ExportProgress } from "../export";
import { importBackup, type ImportProgress, type ImportSummary } from "../import";

type Phase = "idle" | "exporting" | "importing";

const PHASE_LABEL: Record<ExportProgress["phase"] | ImportProgress["phase"], string> = {
  collecting: "收集正文",
  attachments: "下载附件",
  packing: "打包",
  unzipping: "解包",
  verifying: "校验",
  folders: "还原文件夹",
  items: "还原笔记",
  done: "完成",
};

export function BackupPage() {
  const [includeTrashed, setIncludeTrashed] = useState(true);
  const [includeVersions, setIncludeVersions] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ExportProgress | ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  /** 选好但还没确认的文件——确认框里要显示它是什么 */
  const [pending, setPending] = useState<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== "idle";

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  async function runExport(): Promise<void> {
    setError(null);
    setSummary(null);
    setPhase("exporting");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await exportBackup({
        includeTrashed,
        includeVersions,
        onProgress: setProgress,
        signal: controller.signal,
      });
    } catch (cause) {
      // 取消不是错误：用户自己点的，不该弹红字
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      abortRef.current = null;
      setPhase("idle");
    }
  }

  async function runImport(): Promise<void> {
    if (!pending) return;
    setError(null);
    setSummary(null);
    setPhase("importing");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await importBackup(pending, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      setSummary(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      abortRef.current = null;
      setPending(null);
      setPhase("idle");
    }
  }

  return (
    <>
      <section className="setcard" aria-label="导出备份">
        <h3 className="setcard__title">
          导出备份
          <InfoHint label="导出说明">
            导出的是一个 zip，解开后是明文目录：一篇笔记一个 <code>.md</code>，附件按内容哈希存。
            加密条目的密文原样导出，但**不会**导出任何密钥——所以这个 zip 请按敏感文件对待。
          </InfoHint>
        </h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">包含回收站里的笔记</span>
            <span className="setrow__desc">关掉则只导出正常笔记</span>
          </div>
          <span className="setrow__control">
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={includeTrashed}
              aria-label="包含回收站里的笔记"
              disabled={busy}
              onClick={() => setIncludeTrashed(!includeTrashed)}
            />
          </span>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">包含历史版本</span>
            <span className="setrow__desc">默认不含：版本条数上限不低，体积会明显变大</span>
          </div>
          <span className="setrow__control">
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={includeVersions}
              aria-label="包含历史版本"
              disabled={busy}
              onClick={() => setIncludeVersions(!includeVersions)}
            />
          </span>
        </div>

        <div className="setrow">
          <span className="setrow__control">
            {phase === "exporting" ? (
              <Button variant="secondary" size="sm" onClick={stop}>
                取消
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void runExport()}>
                导出备份
              </Button>
            )}
          </span>
        </div>
      </section>

      <section className="setcard" aria-label="从备份恢复">
        <h3 className="setcard__title">
          从备份恢复
          <InfoHint label="恢复说明">
            恢复会把备份里的笔记与文件夹**写进当前实例**。同一个备份反复恢复不会产生重复条目；
            校验不通过的包会被整包拒收，不会只读一半。
          </InfoHint>
        </h3>

        <div className="setrow">
          <span className="setrow__control">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="visually-hidden"
              aria-label="选择备份文件"
              tabIndex={-1}
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                // 同一个文件连选两次也要能触发
                event.currentTarget.value = "";
                setPending(file);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              选择备份文件
            </Button>
          </span>
        </div>

        {pending && phase === "idle" ? (
          <p className="hint-line">已选择：{pending.name}，点「继续」后会先让你确认。</p>
        ) : null}
      </section>

      {/* 实时状态必须可见，不进 ⓘ（DESIGN.md §5.4-2） */}
      {busy && progress ? (
        <section className="setcard" aria-label="备份进行中" aria-live="polite">
          <h3 className="setcard__title">正在处理</h3>
          <p className="hint-line">
            {PHASE_LABEL[progress.phase]} {progress.done} / {progress.total}
          </p>
        </section>
      ) : null}

      {error ? (
        <div className="banner banner--warn" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {summary ? (
        <section className="setcard" aria-label="恢复结果">
          <h3 className="setcard__title">恢复结果</h3>
          <p className="hint-line">
            文件夹 {summary.foldersRestored} 个，笔记 {summary.itemsRestored} 篇，附件{" "}
            {summary.attachmentsRestored} 个。
          </p>
          {summary.itemsFromTrash > 0 ? (
            <p className="hint-line">
              其中 {summary.itemsFromTrash} 篇原本在回收站；同步完成后，服务端那边也会回到回收站。
            </p>
          ) : null}
          {summary.itemsOverwritten > 0 ? (
            <p className="hint-line">
              其中 {summary.itemsOverwritten} 篇与本机现有内容不同，本机内容已被备份内容覆盖；若与云端也不一致，同步时备份内容会另存为冲突副本（标题带后缀）。
            </p>
          ) : null}
          {summary.attachmentsFailed > 0 ? (
            <p className="hint-line">{summary.attachmentsFailed} 个附件没能恢复，正文里的链接会缺图。</p>
          ) : null}
        </section>
      ) : null}

      {/* 危险动作的二次确认：影响与理由写全（DESIGN.md §5.1-2） */}
      <Modal
        open={pending !== null && phase === "idle"}
        title="从这份备份恢复？"
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button variant="danger" size="sm" onClick={() => void runImport()}>
              继续
            </Button>
          </>
        }
      >
        <p>恢复会把备份里的笔记与文件夹写进当前实例：没有的会新增，与设备上现有条目同 id 的会覆盖本机内容。</p>
        <p>被覆盖的条目在同步时若与云端也不一致，备份内容会另存为冲突副本（标题带后缀），不会静默丢失。</p>
        <p>同一个备份反复恢复不会产生重复条目；但恢复过程中请不要关闭页面。</p>
        <p>如果包不完整或校验不通过，会整包拒收，不会只恢复一半。</p>
      </Modal>
    </>
  );
}
