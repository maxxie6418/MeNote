/**
 * 编辑试验的样文（设置 › 编辑试验）。
 *
 * **只写这一把钥匙**，不进笔记库、不同步、不进搜索索引。正式工作区的条目与这里的三篇互不读取。
 * 坏数据一律退回样文，不抛错，也不去碰别的存储。
 */
export const EDITOR_LAB_STORAGE_KEY = "menote:editor-lab:v1";

export const LAB_MODES = ["edit", "preview", "live", "split"] as const;
export type LabMode = (typeof LAB_MODES)[number];

export interface LabNote {
  id: "lab-1" | "lab-2" | "lab-3";
  title: string;
  body: string;
}

export interface LabQuick {
  memo: string;
  task: string;
  note: string;
}

export interface LabState {
  version: 1;
  notes: [LabNote, LabNote, LabNote];
  selectedId: LabNote["id"];
  mode: LabMode;
  quick: LabQuick;
}

const NOTE_IDS: readonly LabNote["id"][] = ["lab-1", "lab-2", "lab-3"];

export function defaultLabState(): LabState {
  return {
    version: 1,
    selectedId: "lab-1",
    mode: "split",
    quick: { memo: "", task: "", note: "" },
    notes: [
      {
        id: "lab-1",
        title: "短文",
        body: ["# 短文", "", "一段**粗体**和一段 `行内代码`。", "", "用来看打字和切走再切回是否丢字。"].join("\n"),
      },
      {
        id: "lab-2",
        title: "代码块",
        body: [
          "# 代码块",
          "",
          "```ts",
          "function greet(name: string) {",
          "  return `你好，${name}`;",
          "}",
          "```",
          "",
          "切到预览时看代码块，切回编辑时看源码还在不在。",
        ].join("\n"),
      },
      {
        id: "lab-3",
        title: "稍长",
        body: [
          "# 稍长的一篇",
          "",
          ...Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段。切换这篇时如果卡住，读数里会留下毫秒数。`),
        ].join("\n\n"),
      },
    ],
  };
}

function isMode(value: unknown): value is LabMode {
  return typeof value === "string" && (LAB_MODES as readonly string[]).includes(value);
}

function isNoteId(value: unknown): value is LabNote["id"] {
  return value === "lab-1" || value === "lab-2" || value === "lab-3";
}

function notesFrom(value: unknown, fallback: LabState["notes"]): LabState["notes"] {
  if (!Array.isArray(value)) return fallback;
  const byId = new Map<string, LabNote>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<LabNote>;
    if (!isNoteId(record.id) || typeof record.title !== "string" || typeof record.body !== "string") continue;
    byId.set(record.id, { id: record.id, title: record.title, body: record.body });
  }
  const notes = NOTE_IDS.map((id) => byId.get(id) ?? fallback.find((note) => note.id === id)!);
  return [notes[0]!, notes[1]!, notes[2]!];
}

/** 读试验库。没有、坏了、钥匙不对，都退回三篇样文。 */
export function loadLabState(storage: Pick<Storage, "getItem"> | null): LabState {
  const fallback = defaultLabState();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(EDITOR_LAB_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LabState>;
    if (parsed.version !== 1) return fallback;
    const quick = parsed.quick;
    return {
      version: 1,
      notes: notesFrom(parsed.notes, fallback.notes),
      selectedId: isNoteId(parsed.selectedId) ? parsed.selectedId : fallback.selectedId,
      mode: isMode(parsed.mode) ? parsed.mode : fallback.mode,
      quick: {
        memo: typeof quick?.memo === "string" ? quick.memo : "",
        task: typeof quick?.task === "string" ? quick.task : "",
        note: typeof quick?.note === "string" ? quick.note : "",
      },
    };
  } catch {
    return fallback;
  }
}

/** 只写试验钥匙。调用方不得把正文再送进笔记库。 */
export function saveLabState(state: LabState, storage: Pick<Storage, "setItem">): void {
  storage.setItem(EDITOR_LAB_STORAGE_KEY, JSON.stringify(state));
}
