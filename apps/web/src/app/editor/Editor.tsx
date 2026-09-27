/**
 * CodeMirror 6 封装（架构 §2.3.2：公共编辑器组件放 `app/editor/`）。
 *
 * 三条约束：
 * 1. **只在挂载时创建 `EditorView`**：切换编辑/预览模式只切布局与扩展，不重建文档（架构 §3.3）。
 * 2. 只读开关用 `Compartment` 重配置，同样不重建文档。
 * 3. 组件本身不做保存策略——自动保存节奏在 `features/notes/model.ts`，这里只把变更抛出去。
 *
 * 切换条目时由父组件用 `key={itemId}` 重新挂载，避免两篇文档互相污染。
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

/** 交给外部的编辑器句柄：读、在光标处插入、按标记替换 */
export interface EditorHandle {
  read(): string;
  insert(text: string): void;
  /** 把正文里的 `marker` 换成 `text`；找不到标记时按"插入"兜底 */
  replace(marker: string, text: string): void;
}

export interface EditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  /** 只读（预览模式或锁定态） */
  readOnly?: boolean;
  /** 挂载后把句柄交给外部（状态栏计量、附件占位替换都用它） */
  onReady?: (handle: EditorHandle) => void;
  /**
   * 粘贴或拖入文件（M4-10；界面稿 §7.1）：编辑器只负责**把文件交出去**，
   * 上传与占位替换在 `features/attachments` 里——编辑器不该知道附件怎么传。
   */
  onFiles?: (files: File[]) => void;
  className?: string;
  ariaLabel?: string;
}

/** 从剪贴板/拖放数据里取文件（`items` 优先：`files` 在部分浏览器里拿不到剪贴板图片） */
export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (fromItems.length > 0) return fromItems;
  return [...data.files];
}

export function Editor({
  initialValue,
  onChange,
  readOnly = false,
  onReady,
  onFiles,
  className,
  ariaLabel,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onFilesRef = useRef(onFiles);
  const [readOnlyCompartment] = useState(() => new Compartment());
  /** 拖入时的落点提示（界面稿 §7.1：**可见的**虚线描边，而不只是改光标） */
  const [dragging, setDragging] = useState(false);

  // 回调放进 ref（用 effect 同步，不在渲染期写 ref）；视图只创建一次，靠 ref 取最新回调
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          history(),
          markdown(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          /**
           * 粘贴/拖入文件：**先 `preventDefault`**，否则浏览器会把图片当成
           * `![](blob:...)` 之类的临时地址塞进正文——那是刷新即失效的假引用。
           */
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = filesFromDataTransfer(event.clipboardData);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
            drop: (event) => {
              const files = filesFromDataTransfer(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
            dragover: (event) => {
              // 让浏览器把这里当合法落点，`drop` 才会触发
              event.preventDefault();
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });

    viewRef.current = view;
    onReadyRef.current?.(makeHandle(view));

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时创建：initialValue 的变化不应重建文档（架构 §3.3）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只读开关后续可切（切预览），走 Compartment 重配置，不重建文档
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, readOnlyCompartment]);

  return (
    <div
      className={[className, dragging ? "editor--drop" : null].filter(Boolean).join(" ")}
      onDragEnter={() => setDragging(true)}
      onDragOver={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDrop={() => setDragging(false)}
    >
      <div ref={hostRef} data-editor aria-label={ariaLabel} />
    </div>
  );
}

/** 句柄：读 / 插入 / 按标记替换——三者都直接落在 `EditorView` 上，不持有全局状态 */
function makeHandle(view: EditorView): EditorHandle {
  const insert = (text: string): void => {
    const position = view.state.selection.main.head;
    view.dispatch({
      changes: { from: position, insert: text },
      selection: { anchor: position + text.length },
    });
  };

  return {
    read: () => view.state.doc.toString(),
    insert,
    replace: (marker, text) => {
      const body = view.state.doc.toString();
      const index = body.indexOf(marker);
      if (index < 0) {
        // 标记不在（用户手动删了占位、或编辑器刚重挂载）→ 插在光标处兜底，别让附件白白传完
        if (text !== "") insert(text);
        return;
      }
      view.dispatch({ changes: { from: index, to: index + marker.length, insert: text } });
    },
  };
}
