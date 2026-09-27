// @vitest-environment jsdom
/**
 * 正文按需取（M1 的既定行为，2026-09-27 补上）。
 *
 * **发现经过**（第三轮调用点审计）：`itemsApi.getBody` 定义了但**一个调用点都没有**，
 * 而本地库只是缓存——于是新设备 / 清过本地库 / 很久没打开过的那一篇，打开时看到的是
 * **空白编辑器**，一编辑就与服务端的正文撞成冲突副本。而《同步引擎设计》§五 里
 * "正文按需取 + 已打开过的缓存"还标着 ✅（M1）。
 *
 * 四条口径：
 * 1. 本地没有、**且没有未上传草稿**时，去服务端取一次并写进正文缓存；
 * 2. **有草稿就不取**——草稿是用户还没上传的改动，拿服务端版本覆盖它会丢数据；
 * 3. 离线 / 404 / 网络错一律 **返回 null、保持空正文且照常可编辑**（抛错会让这一篇直接打不开）；
 * 4. 取到之后再打开同一篇，**不再发请求**（缓存命中）。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, createLocalNote, getCachedBody, putCachedBody, saveDraft } from "../src/data/db";
import { createNoteEditor } from "../src/features/notes/model";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/**
 * 模拟"**同步下来但正文不在本机**"的状态：条目元数据在、**没有草稿**、**没有正文缓存**。
 *
 * 这是新设备 / 清过本地库后第一次打开某篇的真实形态。
 * 注意不能用 `createLocalNote` 直接当起点——它会连草稿一起写（那是"用户在本机新建了一篇"，
 * 草稿是用户的内容，草稿优先是对的），所以这里把它写下的草稿与正文都删掉。
 */
async function seedSyncedItem(id = "i1"): Promise<void> {
  await createLocalNote(id, "标题", "", NOW);
  await db.drafts.delete(id);
  await db.bodies.delete(id);
}

describe("正文按需取", () => {
  it("本地没有正文时去服务端取，并写进正文缓存", async () => {
    await seedSyncedItem();
    const fetchBody = vi.fn(async () => ({
      body: "服务端的正文",
      rev: 3,
      contentHash: "h-remote",
    }));

    const editor = createNoteEditor({ itemId: "i1", fetchBody, now: () => NOW });
    const body = await editor.load();

    expect(body).toBe("服务端的正文");
    expect(fetchBody).toHaveBeenCalledWith("i1");
    // 写进缓存 → 下次打开不再发请求
    expect((await getCachedBody("i1"))?.body).toBe("服务端的正文");
  });

  it("缓存命中时**不发请求**（第二次打开同一篇）", async () => {
    await seedSyncedItem();
    await putCachedBody("i1", "已经缓存过的正文", 1, "h1", NOW);
    const fetchBody = vi.fn(async () => ({ body: "不该用到", rev: 9, contentHash: "h9" }));

    const editor = createNoteEditor({ itemId: "i1", fetchBody, now: () => NOW });
    expect(await editor.load()).toBe("已经缓存过的正文");
    expect(fetchBody).not.toHaveBeenCalled();
  });

  it("**有未上传草稿时不取**（否则会用服务端版本盖掉用户没上传的改动）", async () => {
    await seedSyncedItem();
    await saveDraft("i1", "还没上传的改动", NOW);
    const fetchBody = vi.fn(async () => ({ body: "服务端的旧版", rev: 1, contentHash: "h" }));

    const editor = createNoteEditor({ itemId: "i1", fetchBody, now: () => NOW });
    expect(await editor.load()).toBe("还没上传的改动");
    expect(fetchBody).not.toHaveBeenCalled();
  });

  it("取不到（null）时保持空正文、不抛错，照常可编辑", async () => {
    await seedSyncedItem();
    const fetchBody = vi.fn(async () => null);

    const editor = createNoteEditor({ itemId: "i1", fetchBody, now: () => NOW });
    expect(await editor.load()).toBe("");
    // 能正常输入（不因为取不到就把这一篇变成只读）
    editor.onInput("我先写点东西");
    expect(editor.getSnapshot().bytes).toBeGreaterThan(0);
  });

  it("取正文失败（抛错）也不会让这一篇打不开", async () => {
    await seedSyncedItem();
    const fetchBody = vi.fn(async () => {
      throw new Error("网络断了");
    });

    const editor = createNoteEditor({ itemId: "i1", fetchBody, now: () => NOW });
    expect(await editor.load()).toBe("");
  });

  it("没注入 fetchBody 时行为不变（本地库优先，缺了就是空）", async () => {
    await seedSyncedItem();
    const editor = createNoteEditor({ itemId: "i1", now: () => NOW });
    expect(await editor.load()).toBe("");
  });
});
