/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 内容完整性六表（M4-2；《M4 设计》§六）。
 *
 * 这里验的不是"表建出来了"（那由 `schema.test.ts` 的完整性校验覆盖），而是**DDL 里的约束真在生效**：
 * CHECK 写错一个值、唯一索引少一列，光看"表存在"是发现不了的，而这几处恰好是后面所有清理逻辑的
 * 安全网——例如"缩略图沿用原图 sha256" 这条身份约定，靠的就是 `(user_id, sha256, kind)` 唯一索引。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { freshDatabase } from "./helpers";

async function insertAttachment(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const row = {
    id: "a1",
    user_id: "u1",
    kind: "original",
    parent_id: null,
    sha256: "h1",
    r2_key: "a/u1/h1",
    mime: "image/png",
    size_bytes: 1024,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO attachments (id, user_id, kind, parent_id, sha256, r2_key, mime, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.user_id,
      row.kind,
      row.parent_id,
      row.sha256,
      row.r2_key,
      row.mime,
      row.size_bytes,
      row.created_at,
      row.updated_at,
    )
    .run();
}

beforeEach(async () => {
  await freshDatabase();
});

describe("attachments：身份与上限", () => {
  it("同一 (user, sha256, kind) 只能有一行——这正是「秒传」与「缩略图沿用原图哈希」的落点", async () => {
    await insertAttachment();
    await expect(insertAttachment({ id: "a2", r2_key: "a/u1/h1-again" })).rejects.toThrow();

    // 换 kind（缩略图）就是另一行：身份三元组不同
    await insertAttachment({ id: "t1", kind: "thumb", parent_id: "a1", r2_key: "a/u1/h1.t" });
    // 换用户也是另一行
    await insertAttachment({ id: "a3", user_id: "u2", r2_key: "a/u2/h1" });
  });

  it("kind 只允许 original / thumb", async () => {
    await expect(insertAttachment({ kind: "raw" })).rejects.toThrow();
  });

  it("单附件体积超过 20MB 被 DB 拒绝（CHECK 20971520）", async () => {
    await insertAttachment({ size_bytes: 20 * 1024 * 1024 });
    await expect(insertAttachment({ id: "big", size_bytes: 20 * 1024 * 1024 + 1 })).rejects.toThrow();
  });
});

describe("attachment_refs：当前稿与历史稿分别去重", () => {
  it("同一 (item, 版本, 附件) 只能有一行，而 version_id 为 NULL 的当前稿引用同样受约束", async () => {
    const insert = (versionId: string | null, attachmentId = "a1") =>
      env.DB.prepare(
        "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES (?, ?, ?, 1)",
      )
        .bind("i1", versionId, attachmentId)
        .run();

    await insert(null);
    // 当前稿的同一附件不能重复引用（NULL 的去重靠 IFNULL(version_id,'') 这个表达式唯一索引）
    await expect(insert(null)).rejects.toThrow();

    // 历史版本引用是另一条
    await insert("v1");
    await expect(insert("v1")).rejects.toThrow();

    // 换附件当然可以
    await insert(null, "a2");
  });
});

describe("item_versions：codec 与 keep", () => {
  it("codec 只允许 gzip / none，keep 默认 0", async () => {
    const insert = (codec: string) =>
      env.DB.prepare(
        `INSERT INTO item_versions (id, item_id, user_id, rev, reason, codec, size_bytes, content_hash, r2_key, created_at)
         VALUES (?, 'i1', 'u1', 1, 'manual', ?, 10, 'h', 'v/u1/i1/v1', 1)`,
      )
        .bind(`v-${codec}`, codec)
        .run();

    await insert("gzip");
    await insert("none");
    await expect(insert("zstd")).rejects.toThrow();

    const row = await env.DB.prepare("SELECT keep FROM item_versions WHERE id = 'v-gzip'").first<{
      keep: number;
    }>();
    expect(row?.keep).toBe(0);
  });
});

describe("tombstones / r2_gc_queue / pending_uploads", () => {
  it("墓碑按 (user, entity, entity_id) 唯一，entity 只允许 item / folder", async () => {
    const insert = (entity: string, entityId = "x1") =>
      env.DB.prepare(
        "INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at) VALUES ('u1', ?, ?, 1, 1)",
      )
        .bind(entity, entityId)
        .run();

    await insert("item");
    await expect(insert("item")).rejects.toThrow();
    await insert("folder", "x1"); // 不同实体类型不算重复
    await expect(insert("attachment")).rejects.toThrow();
  });

  it("R2 队列以键为主键，reason 只允许三种", async () => {
    const insert = (reason: string) =>
      env.DB.prepare(
        "INSERT INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at) VALUES ('k1', 'u1', ?, 1, 1)",
      )
        .bind(reason)
        .run();

    await insert("delete");
    await expect(insert("delete")).rejects.toThrow(); // 同一把键只登一次（用 INSERT OR IGNORE 入队）
    await expect(insert("whatever")).rejects.toThrow();
  });

  it("上传登记以 R2 键为主键（同一把键不会登记两次）", async () => {
    const insert = () =>
      env.DB.prepare(
        "INSERT INTO pending_uploads (r2_key, user_id, created_at, due_at) VALUES ('k1', 'u1', 1, 2)",
      ).run();

    await insert();
    await expect(insert()).rejects.toThrow();
  });
});
