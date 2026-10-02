/**
 * 单篇导出（M15）用例。盯四件事：
 * 1. `.md` 逐字（front matter 原样，与备份 §2.1 同一哲学）；
 * 2. 文件名来自标题且净化（Windows 保留字符、空标题）；
 * 3. **草稿优先**——刚敲还没同步的字必须在导出里（与备份导出同一理由）；
 * 4. 含附件：zip 布局与备份一致（`attachments/<sha256>--<文件名>`），
 *    哈希不符整次失败——缺件的包比不给包更容易被误当成完整的。
 */
import "fake-indexeddb/auto";
import { sha256Hex } from "@menote/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createLocalNote, db, saveDraft } from "../src/data/db";
import { exportNoteMarkdown, noteExportFileName } from "../src/features/backup/export-note";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

interface Captured {
  blob: Blob;
  fileName: string;
}

function captureSave(): { blobs: Captured[]; saveBlob: (blob: Blob, fileName: string) => void } {
  const blobs: Captured[] = [];
  return { blobs, saveBlob: (blob, fileName) => void blobs.push({ blob, fileName }) };
}

describe("单篇导出：文件名", () => {
  it("非法字符替换成下划线，空标题退回「未命名」", () => {
    expect(noteExportFileName("a/b:c*d?e")).toBe("a_b_c_d_e.md");
    expect(noteExportFileName("   ")).toBe("未命名.md");
    expect(noteExportFileName(null)).toBe("未命名.md");
  });

  it("过长截到 80 字", () => {
    expect(noteExportFileName("长".repeat(100)).length).toBeLessThanOrEqual(80 + ".md".length);
  });
});

describe("单篇导出：Markdown 本体", () => {
  it("只导 .md：正文逐字、文件名来自标题", async () => {
    await createLocalNote("01AAA", "我的笔记", "# 标题\n\n正文一行", 1_000);
    const cap = captureSave();

    await exportNoteMarkdown({ id: "01AAA", title: "我的笔记", saveBlob: cap.saveBlob });

    expect(cap.blobs).toHaveLength(1);
    expect(cap.blobs[0]?.fileName).toBe("我的笔记.md");
    expect(await cap.blobs[0]!.blob.text()).toBe("# 标题\n\n正文一行");
  });

  it("草稿优先：没同步的修改也在导出里", async () => {
    await createLocalNote("01BBB", "标题", "旧正文", 1_000);
    await saveDraft("01BBB", "新正文（还没同步）", 2_000);
    const cap = captureSave();

    await exportNoteMarkdown({ id: "01BBB", title: "标题", saveBlob: cap.saveBlob });

    expect(await cap.blobs[0]!.blob.text()).toBe("新正文（还没同步）");
  });
});

describe("单篇导出：含附件", () => {
  it("zip 里是 .md + attachments/<sha256>--<文件名>，附件字节原样", async () => {
    const bytes = new Uint8Array([9, 9, 9, 7]);
    const sha = await sha256Hex(bytes);
    await createLocalNote("01CCC", "带图", `![]( /api/attachments/h/${sha})`.replace(" /", "/"), 1_000);
    const cap = captureSave();

    await exportNoteMarkdown({
      id: "01CCC",
      title: "带图",
      includeAttachments: true,
      fetchAttachment: async () => bytes,
      saveBlob: cap.saveBlob,
    });

    expect(cap.blobs).toHaveLength(1);
    expect(cap.blobs[0]?.fileName).toBe("带图.zip");
    const packed = unzipSync(new Uint8Array(await cap.blobs[0]!.blob.arrayBuffer()));
    expect([...Object.keys(packed)].sort()).toEqual(
      [`attachments/${sha}--attachment`, "带图.md"].sort(),
    );
    expect(packed[`attachments/${sha}--attachment`]).toEqual(bytes);
    expect(await new Blob([packed["带图.md"] as BlobPart]).text()).toBe(
      `![](/api/attachments/h/${sha})`,
    );
  });

  it("同一个附件被引用多次只打一份包（内容寻址去重）", async () => {
    const bytes = new Uint8Array([1]);
    const sha = await sha256Hex(bytes);
    const body = `![](/api/attachments/h/${sha})\n\n![](/api/attachments/h/${sha})`;
    await createLocalNote("01DDD", "重复引用", body, 1_000);
    const cap = captureSave();

    await exportNoteMarkdown({
      id: "01DDD",
      title: "重复引用",
      includeAttachments: true,
      fetchAttachment: async () => bytes,
      saveBlob: cap.saveBlob,
    });

    const packed = unzipSync(new Uint8Array(await cap.blobs[0]!.blob.arrayBuffer()));
    expect(Object.keys(packed)).toHaveLength(2);
  });

  it("附件哈希不符：整次失败，不产出一个缺件的包", async () => {
    const sha = await sha256Hex(new Uint8Array([1]));
    await createLocalNote("01EEE", "坏附件", `![](/api/attachments/h/${sha})`, 1_000);
    const cap = captureSave();

    await expect(
      exportNoteMarkdown({
        id: "01EEE",
        title: "坏附件",
        includeAttachments: true,
        fetchAttachment: async () => new Uint8Array([2, 2]),
        saveBlob: cap.saveBlob,
      }),
    ).rejects.toThrow(/内容与引用不符/);
    expect(cap.blobs).toHaveLength(0);
  });
});
