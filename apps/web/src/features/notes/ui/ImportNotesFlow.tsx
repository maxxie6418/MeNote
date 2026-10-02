/**
 * 「导入笔记」的界面流程（v0.6.16）：隐藏的文件选择器 → 多选确认 → 结果。
 *
 * 为什么单独一个文件：`NotebookPanel` 已 350 行、顶着 500 行预算（架构 §2.3.1），
 * 而"文件选择器 + 确认框 + 失败清单"自成一块界面职责。
 *
 * 三条口径：
 * 1. **单选直接进，多选才确认**。导入是新增不是覆盖（不像备份恢复会覆盖同 id 条目），
 *    单个文件没什么可反悔的；多个一旦落错地方清理很烦，所以留一道，写清"几个 → 哪个笔记本"；
 * 2. **失败清单用弹窗而不是轻提示**。`DESIGN.md` §5.4-2：错误与校验提示**必须保持可见**，
 *    Toast 会自动消失，装不下"哪几个文件、为什么"；
 * 3. `input.value` 每次用完清空——同一个文件连选两次也要能再次触发。
 */
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { pushToast, type ToastTone } from "../../../app/ui/Toast";
import type { ImportNotesSummary } from "../import-md";

/** 触发器在 `+` 菜单里（`DropdownMenu` 的菜单项），所以由外面拿 `ref` 唤起文件选择器 */
export interface ImportNotesFlowHandle {
  open: () => void;
}

export interface ImportNotesFlowProps {
  ref?: Ref<ImportNotesFlowHandle>;
  /** 落点名字：确认框与结果里都用它（如「工作」/「根目录」/加密空间名） */
  targetLabel: string;
  onImport: (files: readonly File[]) => Promise<ImportNotesSummary>;
  /** 注入用：测试里替掉轻提示 */
  notify?: (message: string, tone: ToastTone) => void;
}

function defaultNotify(message: string, tone: ToastTone): void {
  pushToast(message, tone);
}

export function ImportNotesFlow({
  ref,
  targetLabel,
  onImport,
  notify = defaultNotify,
}: ImportNotesFlowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 已选、待确认的文件（只有多选才会进这里） */
  const [pending, setPending] = useState<File[] | null>(null);
  /** 导入完没能进来的文件：名字 + 原因 */
  const [skipped, setSkipped] = useState<ImportNotesSummary["skipped"] | null>(null);
  const [busy, setBusy] = useState(false);

  // 空依赖：句柄只做一件事（代点文件选择器），不随渲染换身份
  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), []);

  async function runImport(files: readonly File[]): Promise<void> {
    setPending(null);
    setBusy(true);
    try {
      const summary = await onImport(files);
      if (summary.skipped.length > 0) setSkipped(summary.skipped);
      // 一个都没进来时也要说话：光弹失败清单不够，得先给一句结论
      if (summary.created === 0) notify("没能导入任何文件，详见下面的清单", "error");
      else if (summary.skipped.length === 0) {
        notify(`已导入 ${summary.created} 篇笔记`, "success");
      } else {
        notify(`已导入 ${summary.created} 篇，${summary.skipped.length} 个没成功`, "warn");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败，请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  function onFilesPicked(list: FileList | null): void {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    // 单个直接进；多个先确认
    if (files.length === 1) void runImport(files);
    else setPending(files);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        className="visually-hidden"
        aria-label="选择要导入的 Markdown 文件"
        tabIndex={-1}
        disabled={busy}
        onChange={(event) => {
          onFilesPicked(event.currentTarget.files);
          // 同一个文件连选两次也要能触发
          event.currentTarget.value = "";
        }}
      />

      <Modal
        open={pending !== null}
        title={`把 ${pending?.length ?? 0} 个文件导入「${targetLabel}」？`}
        desc="一个文件建一篇笔记：标题取文件名，正文原样导入。内容是表格或待办的 .md 会按原样打开。"
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void runImport(pending ?? [])}
            >
              导入
            </Button>
          </>
        }
      >
        <p className="hint-line">{pending?.map((file) => file.name).join("、")}</p>
      </Modal>

      <Modal
        open={skipped !== null}
        title="这些文件没能导入"
        desc="其余文件已经导入成功，下面这些没有动。"
        onClose={() => setSkipped(null)}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setSkipped(null)}>
            知道了
          </Button>
        }
      >
        <ul className="hint-line">
          {(skipped ?? []).map((entry) => (
            <li key={entry.name}>
              {entry.name}：{entry.reason}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
