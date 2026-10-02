/**
 * 备份导出/导入的端到端往返用例（格式契约本身的用例在 `packages/shared/test/backup.test.ts`）。
 *
 * 这里盯的是三件事：
 * 1. **往返不丢东西** —— 导出的条目能被导回来，正文一字不差；
 * 2. **幂等** —— 同一份备份连导两次，**条目数不变**（设计 §五，用例是这条的看门狗）；
 * 3. **还原的是当时的状态，不是新建的状态** —— 置顶 / 收藏 / 单篇加密标记 /
 *    创建时间都要保住（这正是不能直接用 `createLocalItem` 的原因）。
 */
import "fake-indexeddb/auto";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  COMPLETE_NAME,
  MANIFEST_NAME,
  SNAPSHOT_DIR,
  renderComplete,
  sha256Hex,
  verifySnapshot,
} from "@menote/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLocalItem,
  createLocalNote,
  db,
  listLocalItems,
  listOutbox,
} from "../src/data/db";
import { exportBackup } from "../src/features/backup/export";
import { importBackup } from "../src/features/backup/import";
import { restoreLocalItem } from "../src/features/backup/restore";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 导出一次，把 zip 收在内存里（替掉浏览器的下载与附件网络请求） */
async function exportToBytes(): Promise<Uint8Array> {
  let captured: Uint8Array | null = null;
  await exportBackup({
    onProgress: () => {},
    fetchAttachment: async () => new Uint8Array([1, 2, 3]),
    saveBlob: (blob) => {
      void blob.arrayBuffer().then((buf) => {
        captured = new Uint8Array(buf);
      });
    },
  });
  // saveBlob 里的 arrayBuffer 是异步的，等一拍
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!captured) throw new Error("导出没有产出 zip");
  return captured;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("备份往返", () => {
  it("导出的包能通过整包校验（COMPLETE 与 manifest 对得上）", async () => {
    await createLocalNote("01AAA", "第一篇", "正文一", 1_000);
    await createLocalNote("01BBB", "第二篇", "正文二", 2_000);

    const bytes = await exportToBytes();
    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes);
    const complete = decoder.decode(files[`${SNAPSHOT_DIR}/${COMPLETE_NAME}`]);
    const manifestText = decoder.decode(files[`${SNAPSHOT_DIR}/${MANIFEST_NAME}`]);

    const manifest = await verifySnapshot({ completeText: complete, manifestText });
    expect(manifest.format).toBe(BACKUP_FORMAT);
    expect(manifest.items).toHaveLength(2);
    expect(manifest.version).toBe(BACKUP_VERSION);
  });

  it("正文逐字往返：front matter 与正文都不被改写", async () => {
    const md = "---\nmenote:\n  tags: [a, b]\n---\n\n# 标题\n\n正文里有 **粗体**";
    await createLocalNote("01AAA", "带 front matter", md, 1_000);

    const bytes = await exportToBytes();
    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    const file = new File([bytes as BlobPart], "b.zip");
    await importBackup(file, {
      onProgress: () => {},
      restoreAttachment: async () => {},
    });

    const items = await listLocalItems();
    expect(items).toHaveLength(1);
    const restored = await db.bodies.get("01AAA");
    expect(restored?.body).toBe(md);
  });

  it("**幂等**：同一份备份连导两次，条目数不变，且内容相同时不报覆盖", async () => {
    await createLocalNote("01AAA", "一", "正文一", 1_000);
    await createLocalNote("01BBB", "二", "正文二", 2_000);
    const bytes = await exportToBytes();

    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    const file = new File([bytes as BlobPart], "b.zip");
    const first = await importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} });
    expect(await listLocalItems()).toHaveLength(2);
    // 库已清空后首次导入：没有"同 id 内容不同"的覆盖
    expect(first.itemsOverwritten).toBe(0);

    const second = await importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} });
    expect(await listLocalItems()).toHaveLength(2);
    // 内容逐字相同（哈希相等）：覆盖了 id 但不算"内容不同"
    expect(second.itemsOverwritten).toBe(0);
  });

  it("**覆盖如实回报**：本机已有同 id 但内容不同的条目，导入后计入 itemsOverwritten", async () => {
    await createLocalNote("01AAA", "一", "正文一", 1_000);
    const bytes = await exportToBytes();

    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    // 本机出现了一份内容不同的同 id 条目（比如另一台设备后来改过并同步到了本机）
    await createLocalItem(
      { id: "01AAA", type: "note", title: "一", folder_id: null, tags: [], memo_at: null, body: "正文一（已改动）" },
      5_000,
    );
    await db.outbox.clear();

    const file = new File([bytes as BlobPart], "b.zip");
    const summary = await importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} });
    expect(summary.itemsOverwritten).toBe(1);
    // 导入后本机内容回到备份里的版本
    const cached = await db.bodies.get("01AAA");
    expect(cached?.body).toBe("正文一");
  });

  it("还原的是**当时的状态**，不是新建时的状态（置顶/收藏/单篇加密/创建时间）", async () => {
    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    await restoreLocalItem(
      {
        id: "01AAA",
        type: "note",
        title: "被置顶收藏的",
        folder_id: null,
        body: "正文",
        pinned: true,
        starred: true,
        encSelf: true,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      },
      9_000,
    );

    const item = await db.items.get("01AAA");
    expect(item?.pinned).toBe(1);
    expect(item?.starred).toBe(1);
    expect(item?.enc_self).toBe(1);
    expect(item?.created_at).toBe(1_700_000_000_000);
    // 乐观锁与同步游标归零：服务端不认备份里的旧值，照抄会永久冲突
    expect(item?.rev).toBe(0);
    expect(item?.sync_seq).toBe(0);
  });

  it("还原后出队了一条 create —— 走的是既有推流链路，不另开协议", async () => {
    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    await restoreLocalItem(
      { id: "01AAA", type: "note", title: null, folder_id: null, body: "正文" },
      1_000,
    );
    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("create");
    // 草稿不该留下：它不是"刚敲完还没传"
    expect(await db.drafts.get("01AAA")).toBeUndefined();
  });

  it("回收站条目入队两条且有序：create 在前、trash_item 在后（先建成再软删，设计 §4.2）", async () => {
    await db.items.clear();
    await db.bodies.clear();
    await db.drafts.clear();
    await db.outbox.clear();

    await restoreLocalItem(
      { id: "01BBB", type: "note", title: null, folder_id: null, body: "正文", deletedAt: 500 },
      1_000,
    );
    const outbox = await listOutbox();
    expect(outbox).toHaveLength(2);
    expect(outbox.map((row) => row.op)).toEqual(["create", "trash_item"]);
    // 两条都指向同一条目，且 seq 顺序就是执行顺序（FIFO）
    expect(outbox.map((row) => row.entity_id)).toEqual(["01BBB", "01BBB"]);
  });
});

describe("备份校验：坏包一律拒收", () => {
  it("缺 COMPLETE 的包直接抛，绝不读一半", async () => {
    const { zipSync } = await import("fflate");
    const files: Record<string, Uint8Array> = {
      [`${SNAPSHOT_DIR}/${MANIFEST_NAME}`]: encoder.encode(
        JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }),
      ),
    };
    const file = new File([zipSync(files) as BlobPart], "bad.zip");
    await expect(
      importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} }),
    ).rejects.toThrow(/COMPLETE/);
    // 一条都不该被写进来
    expect(await listLocalItems()).toHaveLength(0);
  });

  it("manifest 被改过（哈希对不上）就拒收", async () => {
    await createLocalNote("01AAA", "一", "正文一", 1_000);
    const bytes = await exportToBytes();
    const { unzipSync, zipSync } = await import("fflate");
    const files = { ...unzipSync(bytes) };
    const manifestText = decoder.decode(files[`${SNAPSHOT_DIR}/${MANIFEST_NAME}`]);
    files[`${SNAPSHOT_DIR}/${MANIFEST_NAME}`] = encoder.encode(
      manifestText.replace('"include_versions": false', '"include_versions": true'),
    );
    const file = new File([zipSync(files) as BlobPart], "tampered.zip");
    await expect(
      importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} }),
    ).rejects.toThrow(/不完整/);
  });

  it("条目路径越界在读文件之前就被拒", async () => {
    const { zipSync } = await import("fflate");
    const manifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app_version: "0.0.0",
      exported_at: new Date(0).toISOString(),
      items: [
        {
          path: "snapshot/../../etc/passwd",
          id: "01AAA",
          type: "note",
          folder_id: null,
          title: null,
          tags: [],
          memo_at: null,
          is_task: 0,
          task_status: null,
          task_due: null,
          task_priority: null,
          pinned: 0,
          starred: 0,
          enc_self: 0,
          in_enc_space: 0,
          content_hash: "a".repeat(64),
          size_bytes: 0,
          rev: 0,
          created_at: 0,
          updated_at: 0,
          deleted_at: null,
        },
      ],
      attachments: [],
      include_trashed: true,
      include_versions: false,
    };
    const manifestText = JSON.stringify(manifest);
    const files: Record<string, Uint8Array> = {
      [`${SNAPSHOT_DIR}/${MANIFEST_NAME}`]: encoder.encode(manifestText),
      [`${SNAPSHOT_DIR}/${COMPLETE_NAME}`]: encoder.encode(
        renderComplete(BACKUP_VERSION, await sha256Hex(encoder.encode(manifestText))),
      ),
    };
    const file = new File([zipSync(files) as BlobPart], "evil.zip");
    await expect(
      importBackup(file, { onProgress: () => {}, restoreAttachment: async () => {} }),
    ).rejects.toThrow();
  });
});
