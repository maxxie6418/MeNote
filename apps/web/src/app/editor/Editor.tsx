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
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { livePreview } from "./live-preview";

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
  /**
   * **即时渲染**（M5 首期，2026-09-28）：正文直接呈现渲染样式、光标所在行显示源码。
   *
   * 走 `Compartment` 重配置（与只读开关同一套做法）——所以"仅编辑 ↔ 即时渲染"切换
   * **不重建文档**（架构 §3.3 的既定要求），撤销历史与光标位置都保住。
   */
  live?: boolean;
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
  live = false,
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
  /** 即时渲染 / 行号那一档扩展（见 `EditorProps.live`） */
  const [viewModeCompartment] = useState(() => new Compartment());
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
          history(),
          /*
            base 用 `markdownLanguage`（= commonmark + GFM）：`markdown()` 的**默认 base 是纯
            CommonMark**，那样 `| a | b |` 不是表格、`- [ ]` 不是任务清单、`~~x~~` 不是删除线
            （`[x]` 甚至会被解析成链接）。即时渲染要覆盖这些，编辑/分屏两档也用同一棵树，
            免得"同一个文档在不同模式下解析结果不一样"。
          */
          markdown({ base: markdownLanguage }),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          // 即时渲染下不显示行号（渲染视图里行号只是噪声）；两档都由这一个 Compartment 管
          viewModeCompartment.of(viewModeExtensions(live)),
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

  /*
    即时渲染开关同理：**重配置而不重建文档**。
    这一条不能省——"仅编辑 ↔ 即时渲染"在 React 树里的位置相同，不会重新挂载编辑器，
    少了它就会"点了模式按钮没反应"。
  */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: viewModeCompartment.reconfigure(viewModeExtensions(live)),
    });
  }, [live, viewModeCompartment]);

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

/**
 * "查看档位"那一组扩展：即时渲染（`livePreview`）或普通编辑（行号）。
 *
 * 两者**互斥**：渲染视图里行号是噪声；而即时渲染藏掉标记之后，行号会给"这一行是源码还是渲染结果"
 * 添乱。它单独成函数是为了让创建时与重配置时**用的是同一份**，不会两边写岔。
 */
function viewModeExtensions(live: boolean): Extension {
  return live ? [livePreview()] : [lineNumbers()];
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
