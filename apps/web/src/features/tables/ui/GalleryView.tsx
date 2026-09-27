/**
 * 图册视图（M4-9；《M4 界面稿》§2.6）。
 *
 * 卡片 = 缩略图（现为文件名占位）+ 标题 + 最多两个属性胶囊；点卡片打开**行详情**。
 *
 * **一处偏离（已在实施计划里登记）**：界面稿说行详情用"既有 `Drawer`（`app/ui/`，390px）"，
 * 但仓库里**没有** `Drawer` 组件（`app/ui/` 只有 Chip / Controls / Icon / Menu / Modal / …）。
 * 自造一个抽屉等于另立视觉，所以这里改用既有的 `Modal` 承载同一件事；
 * 要不要补 `Drawer` 属公共组件 + `DESIGN.md` §6.7 的范围，需用户点头后再做。
 */
import { useState } from "react";
import { type TableColumn, type TableDoc } from "@menote/mdcore";
import { Modal } from "../../../app/ui/Modal";
import { Button, Field } from "../../../app/ui/Controls";
import { Chip } from "../../../app/ui/Chip";
import { cellValue, galleryCards } from "../model";

export interface GalleryViewProps {
  doc: TableDoc;
  columns: readonly TableColumn[];
  onCellChange: (rowId: string, columnId: string, value: string) => void;
  /** 有图片列但一张图都没有时的出口：切回表格视图 */
  onBackToTable: () => void;
}

export function GalleryView({ doc, columns, onCellChange, onBackToTable }: GalleryViewProps) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const cards = galleryCards(doc);
  const withImage = cards.filter((card) => card.image.trim() !== "");
  const openRow = doc.rows.find((row) => cellValue(row, doc.rowIdColumn) === openRowId) ?? null;

  if (withImage.length === 0) {
    return (
      <div className="gallery__empty">
        <p className="gallery__empty-title">这张表还没有图片</p>
        <p className="gallery__empty-hint">在图片列里写上图册要展示的文件名，卡片就会带上封面。</p>
        <Button variant="secondary" size="sm" onClick={onBackToTable}>
          切回表格视图
        </Button>
      </div>
    );
  }

  return (
    <div className="gallery scroll-thin">
      <ul className="gallery__grid">
        {cards.map((card) => (
          <li key={card.rowId}>
            <button
              type="button"
              className="gallery__card"
              onClick={() => setOpenRowId(card.rowId)}
              aria-label={`打开行详情：${card.title || card.rowId}`}
            >
              <span className="gallery__cover" title="缩略图随附件功能（M4-10）接入">
                {card.image.trim() === "" ? "无图片" : card.image}
              </span>
              <span className="gallery__title">{card.title || "（无标题）"}</span>
              <span className="gallery__chips">
                {card.chips.map((chip) => (
                  <Chip key={chip.label} variant="tag" title={chip.label}>
                    {chip.value || "—"}
                  </Chip>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={openRow !== null}
        title="行详情"
        desc="在这里改的是这一行的属性；表格与图册看到的是同一份数据。"
        onClose={() => setOpenRowId(null)}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setOpenRowId(null)}>
            关闭
          </Button>
        }
      >
        <div className="gallery__fields">
          {columns.map((column) => (
            <GalleryField
              key={`${openRowId ?? ""}:${column.id}`}
              label={column.name}
              value={openRow ? cellValue(openRow, column.id) : ""}
              onCommit={(next) => {
                if (openRowId) onCellChange(openRowId, column.id, next);
              }}
            />
          ))}
        </div>
      </Modal>
    </div>
  );
}

/**
 * 行详情里的一项。
 *
 * **必须有本地草稿**：行详情是受控表单，每次键入都回写文档、外层再把新值传回来，
 * 中间只要有一跳不落地就会看到"打字打成了 `甲的`"这种怪象（本地草稿 + 失焦/回车提交就没这问题）。
 */
function GalleryField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <Field
      label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && draft !== value) onCommit(draft);
      }}
    />
  );
}
