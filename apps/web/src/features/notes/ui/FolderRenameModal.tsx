/**
 * 文件夹重命名弹窗（M2-3 建；M3-6 从 `NotebookPanel` 抽出，供**笔记本树与加密空间树**共用）。
 *
 * 走 `meta_rev`：多设备并发改名**以后写为准**、不生成冲突副本（Q12）。
 * 名称不能为空——为空时保存按钮置灰并说明原因（DESIGN.md §6.1）。
 *
 * 调用方**按需挂载**并给 `key={folder.id}`：换文件夹就是重新挂载，
 * 于是初值天然取自新文件夹，不需要在组件里"渲染期 setState 同步 props"。
 */
import { useState } from "react";
import type { LocalFolder } from "../../../data/db";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";

export interface FolderRenameModalProps {
  folder: LocalFolder;
  onClose: () => void;
  onRename: (folderId: string, name: string) => Promise<void>;
}

export function FolderRenameModal({ folder, onClose, onRename }: FolderRenameModalProps) {
  const [name, setName] = useState(folder.name);
  const trimmed = name.trim();

  return (
    <Modal
      open
      title="重命名文件夹"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={trimmed === ""}
            title={trimmed === "" ? "名称不能为空" : undefined}
            onClick={() => {
              onClose();
              void onRename(folder.id, trimmed);
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <input
        className="field__input"
        aria-label="文件夹名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}
