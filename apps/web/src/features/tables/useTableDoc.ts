/**
 * 表格文档与正文之间的桥（M4-9 接线；《M4 界面稿》§二）。
 *
 * **为什么单独一个 hook**：表格的正文是 Markdown（front matter + 管道表格），而表格编辑器要的是
 * 结构化的 `TableDoc`。这个 hook 负责"解析一次 → 编辑结构化对象 → 序列化回正文"，
 * 让 `NoteWorkspace` 只管"这一条要不要走表格界面"。
 *
 * 三条口径：
 * 1. **只解析一次**（挂载时用 `initialBody`）：表格界面不走 CodeMirror，结构化对象就是唯一真源，
 *    每敲一个字都重新解析既浪费又会把用户正在编辑的行 ID 洗掉；
 * 2. **序列化回正文**用 mdcore 的 `renderTableDocument`（前后端同一实现，不在这里重写）；
 * 3. **解析失败不等于要改数据**：`checkDegrade` 只判断"能不能当表格打开"，
 *    降级后的正文由它给出，**但我们不自动写入**——界面稿 §2.10 明确"不静默改数据"。
 */
import { useCallback, useState } from "react";
import { parseTableDocument, renderTableDocument, type TableDoc } from "@menote/mdcore";
import { checkDegrade, type DegradeReason } from "./model";

export type TableDocState =
  /** 结构完整：可以用表格界面编辑 */
  | { kind: "table"; doc: TableDoc }
  /** 解析失败：按普通笔记打开（**原文未改动**），界面稿 §2.10 的自动降级 */
  | { kind: "degrade"; reason: DegradeReason; strippedMarkdown: string };

export interface UseTableDocResult {
  state: TableDocState;
  /** 结构化对象改了 → 序列化回正文（调用方负责保存） */
  commit(next: TableDoc): void;
  /** 当前正文（表格路径下由 `commit` 更新，供"下载当前内容"用） */
  current(): string;
}

export function useTableDoc(initialBody: string): UseTableDocResult {
  const [state, setState] = useState<TableDocState>(() => {
    const parsed = parseTableDocument(initialBody);
    if (parsed.ok) return { kind: "table", doc: parsed.doc };
    const degraded = checkDegrade(initialBody);
    return {
      kind: "degrade",
      // `checkDegrade` 在 ok 时 reason 为 null；走到这里必然是失败态
      reason: degraded.reason ?? "broken_structure",
      strippedMarkdown: degraded.markdown,
    };
  });
  /** 最近的正文：初始是打开时的快照，之后每次提交都更新 */
  const [body, setBody] = useState(initialBody);

  const commit = useCallback(
    (next: TableDoc) => {
      const markdown = renderTableDocument(next);
      setState({ kind: "table", doc: next });
      setBody(markdown);
    },
    [],
  );

  return { state, commit, current: () => body };
}
