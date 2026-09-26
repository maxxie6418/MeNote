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

export interface EditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  /** 只读（预览模式或锁定态） */
  readOnly?: boolean;
  /** 把"读取当前正文"的方法交给外部（状态栏计量用） */
  onReady?: (read: () => string) => void;
  className?: string;
  ariaLabel?: string;
}

export function Editor({
  initialValue,
  onChange,
  readOnly = false,
  onReady,
  className,
  ariaLabel,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const [readOnlyCompartment] = useState(() => new Compartment());

  // 回调放进 ref（用 effect 同步，不在渲染期写 ref）；视图只创建一次，靠 ref 取最新回调
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

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
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });

    viewRef.current = view;
    onReadyRef.current?.(() => view.state.doc.toString());

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

  return <div ref={hostRef} className={className} data-editor aria-label={ariaLabel} />;
}
