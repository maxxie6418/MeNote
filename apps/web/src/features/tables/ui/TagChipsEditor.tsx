/**
 * 标签格的 chip 编辑（M4-9 补；《M4 界面稿》§2.3 的「标签」类型）。
 *
 * 为什么单独一个组件：标签是**一格里的多个值**，用普通文本框写"逗号分隔"虽然能存，
 * 但用户看不出"已经有哪几个"、也没法单独删一个——这正是界面稿要求的 chip 形态。
 *
 * 交互（键盘与鼠标都能完成，界面稿 §2.4 的底线）：
 * - `Enter` / `,` / `，`：把输入框里的内容变成一个 chip；
 * - `Backspace`（输入框为空时）：删掉最后一个 chip；
 * - 每个 chip 右侧有 × 按钮（可点，不只是悬停才出现）；
 * - `Escape` 取消整格编辑；输入框失焦即提交（与其它类型的就地编辑一致）。
 *
 * 存储格式不变：仍然写回**逗号分隔的字符串**（见 `model.ts` 的 `splitTags` / `joinTags`）。
 */
import { useState } from "react";
import { Chip } from "../../../app/ui/Chip";
import { joinTags, splitTags } from "../model";

export interface TagChipsEditorProps {
  /** 当前单元格值（逗号分隔） */
  value: string;
  ariaLabel: string;
  onCommit(next: string): void;
  onCancel(): void;
}

export function TagChipsEditor({ value, ariaLabel, onCommit, onCancel }: TagChipsEditorProps) {
  const [tags, setTags] = useState<string[]>(() => splitTags(value));
  const [draft, setDraft] = useState("");

  const commitAll = (next: readonly string[]): void => {
    onCommit(joinTags(next));
  };

  const addDraft = (raw: string): void => {
    const added = splitTags(raw);
    if (added.length === 0) return;
    const next = joinTags([...tags, ...added]).split(",").filter((tag) => tag !== "");
    setTags(next);
    setDraft("");
  };

  const removeAt = (index: number): void => {
    const next = tags.filter((_, i) => i !== index);
    setTags(next);
  };

  return (
    <span className="tagchips" data-tag-editor>
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`} className="tagchips__item">
          <Chip variant="tag">{tag}</Chip>
          <button
            type="button"
            className="tagchips__remove"
            aria-label={`移除标签 ${tag}`}
            // 用 onMouseDown 而不是 onClick：失焦会先触发提交，把这一格收掉
            onMouseDown={(event) => {
              event.preventDefault();
              removeAt(index);
            }}
          >
            ×
          </button>
        </span>
      ))}

      <input
        className="tagchips__input"
        autoFocus
        aria-label={ariaLabel}
        value={draft}
        placeholder={tags.length === 0 ? "输入标签后回车" : ""}
        onChange={(event) => {
          const next = event.target.value;
          // 逗号即分隔符：直接落成一个 chip（中文逗号也认，用户不该为输入法买单）
          if (next.includes(",") || next.includes("，")) {
            addDraft(next.replace(/，/g, ","));
            return;
          }
          setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (draft.trim() === "") commitAll(tags);
            else addDraft(draft);
            return;
          }
          if (event.key === "Backspace" && draft === "" && tags.length > 0) {
            event.preventDefault();
            removeAt(tags.length - 1);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          // 失焦时把没提交的草稿也算上，再整体提交——避免"打了一半就点别处"把内容丢了
          const added = splitTags(draft);
          commitAll(added.length > 0 ? [...tags, ...added] : tags);
        }}
      />
    </span>
  );
}
