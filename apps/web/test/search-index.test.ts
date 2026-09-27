import "fake-indexeddb/auto";
/**
 * 本地搜索索引（M2-6 建、M3-5 改）：
 * - 索引覆盖**全部未删除条目**（**含隐私条目**）——这样解锁后能立刻搜到，不必重建整张索引；
 * - 增量：`sync_seq` 没变就不重建；删掉的条目连索引行一起清掉；
 * - **门禁在查询时生效**：锁定时空间内条目连标题都不命中；单篇的标题任何状态可搜、正文要已解密；
 * - 检索结果能按类型 / 文件夹 / 标签 / 时间过滤；
 * - `isSearchIndexComplete` 反映"索引是否已覆盖全部未删除条目"。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLocalItem,
  db,
  isSearchIndexComplete,
  refreshSearchIndex,
  searchLocal as searchLocalRaw,
  type SearchFilters,
} from "../src/data/db";
import { privacyGateFrom, type PrivacyGate } from "@menote/shared";

/** 用例里的默认门禁：**未启用**（无门禁）；隐私相关的用例自己传具体的 gate */
const NO_GATE: PrivacyGate = privacyGateFrom(
  { scope: { memo: true }, search_bodies_when_unlocked: true },
  "disabled",
);

/** 默认走"无门禁"，让用例专注在索引与过滤上 */
function searchLocal(query: string, filters: SearchFilters = {}) {
  return searchLocalRaw(query, filters, NO_GATE);
}

let seq = 0;
async function seed(input: {
  id: string;
  title?: string | null;
  type?: "note" | "table" | "memo";
  folderId?: string | null;
  tags?: string[];
  body: string;
  syncSeq?: number;
}) {
  seq += 1;
  const now = 1000 + seq;
  await createLocalItem(
    {
      id: input.id,
      type: input.type ?? "note",
      title: input.title ?? `标题 ${input.id}`,
      folder_id: input.folderId ?? null,
      tags: input.tags ?? [],
      body: input.body,
    },
    now,
  );
  await db.items.update(input.id, {
    sync_seq: input.syncSeq ?? seq,
    updated_at: now,
  });
  return now;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  seq = 0;
});

describe("索引构建（增量）", () => {
  it("给每个可见条目建一行，并带上标题与标签", async () => {
    await seed({ id: "a", title: "会议记录", tags: ["工作"], body: "讨论了发布方案" });

    const result = await refreshSearchIndex();
    expect(result).toEqual({ indexed: 1, removed: 0 });

    const row = await db.searchIndex.get("a");
    // 标题字段（标题 + 标签）与正文字段分开存（M3-5）
    expect(row?.title_text).toContain("会议记录");
    expect(row?.title_text).toContain("#工作");
    expect(row?.body_text).toContain("讨论了发布方案");
    expect(row?.title_haystack).toBe(row?.title_text.toLowerCase());
    expect(row?.body_haystack).toBe(row?.body_text.toLowerCase());
    expect(row?.title_tokens).toContain("会议");
  });

  it("sync_seq 没变就不重建（第二次是 0）", async () => {
    await seed({ id: "a", body: "第一版" });
    await refreshSearchIndex();

    expect(await refreshSearchIndex()).toEqual({ indexed: 0, removed: 0 });

    // 改了 sync_seq 才重建，并且内容跟着更新
    await seed2Update("a", "第二版");
    const again = await refreshSearchIndex();
    expect(again.indexed).toBe(1);
    expect((await db.searchIndex.get("a"))?.body_text).toContain("第二版");
  });

  async function seed2Update(id: string, body: string) {
    // 草稿优先于已缓存正文（正在编辑的内容才算最新），所以两处都要更新
    await db.drafts.put({ item_id: id, body, updated_at: Date.now() });
    await db.bodies.update(id, { body });
    await db.items.update(id, { sync_seq: 999, updated_at: Date.now() });
  }

  it("删掉的条目连索引行一起清掉", async () => {
    await seed({ id: "a", body: "正文" });
    await seed({ id: "b", body: "正文" });
    await refreshSearchIndex();

    await db.items.update("b", { deleted_at: Date.now(), sync_seq: 777 });
    expect(await refreshSearchIndex()).toEqual({ indexed: 0, removed: 1 });
    expect(await db.searchIndex.get("b")).toBeUndefined();
  });

  it("本地未上传的草稿优先入索引（正在编辑的内容也能搜到）", async () => {
    await seed({ id: "a", body: "已缓存的正文" });
    await db.drafts.put({ item_id: "a", body: "草稿里的新内容", updated_at: Date.now() });

    await refreshSearchIndex();
    expect((await db.searchIndex.get("a"))?.body_text).toContain("草稿里的新内容");
  });
});

describe("隐私门禁（M3-5：索引照常建、过滤在查询时）", () => {
  it("隐私条目照常进索引（这样解锁后能立刻搜到，不必重建索引）", async () => {
    await seed({ id: "plain", body: "公开内容 方案" });
    await seed({ id: "enc", body: "加密内容 方案" });
    await seed({ id: "space", body: "空间内容 方案" });

    await db.items.update("enc", { enc_self: 1, sync_seq: 501 });
    await db.items.update("space", { in_enc_space: 1, sync_seq: 502 });
    await refreshSearchIndex();

    expect(await db.searchIndex.get("enc")).toBeDefined();
    expect(await db.searchIndex.get("space")).toBeDefined();
  });

  it("锁定态：空间内条目连标题都不命中；单篇条目的标题可搜、正文搜不到", async () => {
    await seed({ id: "plain", title: "公开标题 方案", body: "公开内容 方案" });
    await seed({ id: "space", title: "空间标题 方案", body: "空间正文 方案" });
    await seed({ id: "enc", title: "单篇标题 方案", body: "单篇正文 方案" });
    await db.items.update("space", { in_enc_space: 1, sync_seq: 501 });
    await db.items.update("enc", { enc_self: 1, sync_seq: 502 });
    await refreshSearchIndex();

    const locked = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "locked",
    );

    // "方案"三个条目都有，但锁定时只有普通内容与单篇（标题）命中
    const hits = await searchLocalRaw("方案", {}, locked);
    expect(hits.map((hit) => hit.item.id).sort()).toEqual(["enc", "plain"]);
    expect(hits.find((hit) => hit.item.id === "enc")?.field).toBe("title");

    // 正文里的词：空间内条目与单篇都搜不到
    expect(await searchLocalRaw("空间正文", {}, locked)).toEqual([]);
    expect(await searchLocalRaw("单篇正文", {}, locked)).toEqual([]);
    expect((await searchLocalRaw("公开内容", {}, locked)).map((h) => h.item.id)).toEqual(["plain"]);
  });

  it("解锁态：空间内条目按标题与正文命中；开关关闭时只剩标题", async () => {
    await seed({ id: "space", title: "空间标题 方案", body: "空间正文 方案" });
    await db.items.update("space", { in_enc_space: 1, sync_seq: 501 });
    await refreshSearchIndex();

    const unlocked = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "unlocked",
    );
    expect((await searchLocalRaw("空间正文", {}, unlocked)).map((h) => h.item.id)).toEqual(["space"]);

    const bodiesOff = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: false },
      "unlocked",
    );
    expect((await searchLocalRaw("空间正文", {}, bodiesOff)).map((h) => h.item.id)).toEqual([]);
    expect((await searchLocalRaw("空间标题", {}, bodiesOff)).map((h) => h.item.id)).toEqual(["space"]);
  });

  it("单篇逐篇解密后才搜得到正文（与隐私锁状态无关）", async () => {
    await seed({ id: "enc", title: "单篇标题", body: "单篇正文 方案" });
    await db.items.update("enc", { enc_self: 1, sync_seq: 501 });
    await refreshSearchIndex();

    const lockedNoDecrypt = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "locked",
    );
    expect(await searchLocalRaw("单篇正文", {}, lockedNoDecrypt)).toEqual([]);

    const lockedDecrypted: PrivacyGate = {
      ...lockedNoDecrypt,
      unlockedItems: new Set(["enc"]),
    };
    expect(
      (await searchLocalRaw("单篇正文", {}, lockedDecrypted)).map((h) => h.item.id),
    ).toEqual(["enc"]);
  });

  it("范围内且锁定时，Memo 完全搜不到；移出范围后照常", async () => {
    await seed({ id: "memo", type: "memo", body: "备忘录 方案" });
    await refreshSearchIndex();

    const locked = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "locked",
    );
    expect(await searchLocalRaw("方案", {}, locked)).toEqual([]);

    const memoOutOfScope = privacyGateFrom(
      { scope: { memo: false }, search_bodies_when_unlocked: true },
      "locked",
    );
    expect(
      (await searchLocalRaw("方案", {}, memoOutOfScope)).map((h) => h.item.id),
    ).toEqual(["memo"]);
  });
});

describe("检索与过滤", () => {
  it("按标题 / 正文 / 标签命中，返回条目与片段", async () => {
    await seed({ id: "a", title: "会议记录", body: "讨论了发布方案" });
    await seed({ id: "b", title: "购物清单", body: "买牛奶" });
    await refreshSearchIndex();

    const byBody = await searchLocal("发布方案");
    expect(byBody.map((hit) => hit.item.id)).toEqual(["a"]);
    expect(byBody[0]?.snippet.match).toContain("发布方案");

    expect((await searchLocal("购物")).map((hit) => hit.item.id)).toEqual(["b"]);
  });

  it("按类型过滤", async () => {
    await seed({ id: "note", type: "note", body: "共同的词 方案" });
    await seed({ id: "memo", type: "memo", body: "共同的词 方案" });
    await refreshSearchIndex();

    expect((await searchLocal("方案", { type: "memo" })).map((h) => h.item.id)).toEqual(["memo"]);
    expect(await searchLocal("方案", { type: "table" })).toEqual([]);
  });

  it("按文件夹过滤（含根目录）", async () => {
    await seed({ id: "in", folderId: "f1", body: "共同的词 方案" });
    await seed({ id: "root", folderId: null, body: "共同的词 方案" });
    await refreshSearchIndex();

    expect((await searchLocal("方案", { folderId: "f1" })).map((h) => h.item.id)).toEqual(["in"]);
    expect((await searchLocal("方案", { folderId: null })).map((h) => h.item.id)).toEqual(["root"]);
  });

  it("按标签过滤", async () => {
    await seed({ id: "work", tags: ["工作"], body: "共同的词 方案" });
    await seed({ id: "life", tags: ["生活"], body: "共同的词 方案" });
    await refreshSearchIndex();

    expect((await searchLocal("方案", { tag: "工作" })).map((h) => h.item.id)).toEqual(["work"]);
  });

  it("按时间范围过滤", async () => {
    const oldAt = await seed({ id: "old", body: "共同的词 方案" });
    const newAt = await seed({ id: "new", body: "共同的词 方案" });
    await refreshSearchIndex();

    expect((await searchLocal("方案", { from: newAt })).map((h) => h.item.id)).toEqual(["new"]);
    expect((await searchLocal("方案", { to: oldAt })).map((h) => h.item.id)).toEqual(["old"]);
  });

  it("没有命中时返回空数组（界面层据此给出口）", async () => {
    await seed({ id: "a", body: "只有这点内容" });
    await refreshSearchIndex();
    expect(await searchLocal("完全不相干")).toEqual([]);
  });
});

describe("索引完成度", () => {
  it("空库视为建完", async () => {
    expect(await isSearchIndexComplete()).toBe(true);
  });

  it("有条目但还没建索引 → false；建完 → true", async () => {
    await seed({ id: "a", body: "正文" });
    expect(await isSearchIndexComplete()).toBe(false);

    await refreshSearchIndex();
    expect(await isSearchIndexComplete()).toBe(true);
  });

  it("条目在索引之后又变了 → false（界面层据此回退服务端并提示）", async () => {
    await seed({ id: "a", body: "正文" });
    await refreshSearchIndex();
    expect(await isSearchIndexComplete()).toBe(true);

    await db.items.update("a", { sync_seq: 4321 });
    expect(await isSearchIndexComplete()).toBe(false);
  });
});
