import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  LOGIN_KDF_DEFAULT,
  AuthKdfParamsSchema,
  RegistrationStateSchema,
  UsernameSchema,
} from "../src/auth";
import { decodeItemWriteMeta, encodeItemWriteMeta, ItemWriteMetaSchema } from "../src/items";
import type { ItemMeta, ItemWriteMeta } from "../src/items";
import { SyncResponseSchema } from "../src/sync";

const noteMeta: ItemMeta = {
  id: "01J0TESTITEM0000000000000",
  type: "note",
  folder_id: null,
  title: "未命名笔记",
  enc_self: 0,
  in_enc_space: 0,
  size_bytes: 12,
  content_hash: "abc",
  tags: [],
  memo_at: null,
  is_task: 0,
  task_status: null,
  task_due: null,
  task_priority: null,
  pinned: 0,
  starred: 0,
  rev: 1,
  meta_rev: 1,
  sealed_rev: null,
  sync_seq: 1,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  last_edit_at: null,
  last_device: null,
  deleted_at: null,
  deleted: false,
};

describe("ItemMeta 线上形态", () => {
  it("接受一条普通笔记", () => {
    expect(v.safeParse(SyncResponseSchema, {
      items: [noteMeta],
      folders: [],
      next_cursor: 1,
      has_more: false,
      full_resync: false,
    }).success).toBe(true);
  });

  it("Memo 允许无标题、无文件夹、有 memo_at", () => {
    const memo: ItemMeta = {
      ...noteMeta,
      type: "memo",
      title: null,
      memo_at: 1_700_000_000_000,
    };
    expect(v.safeParse(SyncResponseSchema, {
      items: [memo],
      folders: [],
      next_cursor: 1,
      has_more: false,
      full_resync: false,
    }).success).toBe(true);
  });

  it("拒绝非法类型、越界大小、负游标、缺字段", () => {
    const withItem = (patch: Record<string, unknown>) => ({ ...noteMeta, ...patch });
    const parseItem = (patch: Record<string, unknown>) =>
      v.safeParse(SyncResponseSchema, {
        items: [withItem(patch)],
        folders: [],
        next_cursor: 0,
        has_more: false,
        full_resync: false,
      }).success;

    expect(parseItem({ type: "page" })).toBe(false);
    expect(parseItem({ size_bytes: 1_900_001 })).toBe(false);
    expect(parseItem({ size_bytes: -1 })).toBe(false);
    expect(parseItem({ enc_self: 2 })).toBe(false);
    expect(parseItem({ rev: 1.5 })).toBe(false);

    const missing = { ...noteMeta } as Record<string, unknown>;
    delete missing.content_hash;
    expect(
      v.safeParse(SyncResponseSchema, {
        items: [missing],
        folders: [],
        next_cursor: 0,
        has_more: false,
        full_resync: false,
      }).success,
    ).toBe(false);
  });

  it("拒绝负数游标", () => {
    const base = { items: [], folders: [], has_more: false, full_resync: false };
    expect(v.safeParse(SyncResponseSchema, { ...base, next_cursor: -1 }).success).toBe(false);
    expect(v.safeParse(SyncResponseSchema, { ...base, next_cursor: 0 }).success).toBe(true);
  });
});

describe("X-Menote-Meta 编解码", () => {
  it("往返一致", () => {
    const meta: ItemWriteMeta = {
      type: "note",
      title: "标题",
      folder_id: null,
      tags: ["工作", "待读"],
      memo_at: null,
      is_task: 0,
      task_status: null,
      task_due: null,
      task_priority: null,
      content_hash: "deadbeef",
    };
    const header = encodeItemWriteMeta(meta);
    expect(header).not.toMatch(/[+/=]/);
    expect(decodeItemWriteMeta(header)).toEqual(meta);
  });

  it("refs 可选（M4 才用）", () => {
    const meta: ItemWriteMeta = {
      type: "table",
      title: null,
      folder_id: "f1",
      tags: [],
      memo_at: null,
      is_task: 0,
      task_status: null,
      task_due: null,
      task_priority: null,
      content_hash: "x",
      refs: ["sha256:abc"],
    };
    expect(v.safeParse(ItemWriteMetaSchema, meta).success).toBe(true);
    expect(decodeItemWriteMeta(encodeItemWriteMeta(meta)).refs).toEqual(["sha256:abc"]);
  });

  it("内容非法时抛错（由路由转 422 invalid）", () => {
    expect(() => decodeItemWriteMeta("not-base64!!")).toThrow();
    expect(() => v.parse(ItemWriteMetaSchema, { type: "note" })).toThrow();
  });
});

describe("认证 schema", () => {
  it("默认 KDF 参数满足自身 schema", () => {
    expect(v.safeParse(AuthKdfParamsSchema, LOGIN_KDF_DEFAULT).success).toBe(true);
    expect(LOGIN_KDF_DEFAULT.iterations).toBe(600_000);
    expect(LOGIN_KDF_DEFAULT.alg).toBe("PBKDF2-SHA256");
  });

  it("拒绝 Argon2id 等非 PBKDF2 参数（v1.1 模型修订后不再引入 wasm）", () => {
    expect(
      v.safeParse(AuthKdfParamsSchema, {
        alg: "argon2id",
        iterations: 600_000,
        saltBytes: 16,
        dkLen: 32,
      }).success,
    ).toBe(false);
  });

  it("用户名规则：1–32 位、字母数字与 _-.", () => {
    expect(v.safeParse(UsernameSchema, "abc_1-2.3").success).toBe(true);
    expect(v.safeParse(UsernameSchema, "中文名").success).toBe(false);
    expect(v.safeParse(UsernameSchema, "ab c").success).toBe(false);
    expect(v.safeParse(UsernameSchema, "").success).toBe(false);
    expect(v.safeParse(UsernameSchema, "a".repeat(33)).success).toBe(false);
    expect(v.safeParse(UsernameSchema, "a".repeat(32)).success).toBe(true);
  });

  it("注册开关：close_at = 0 表示不自动到期", () => {
    expect(v.safeParse(RegistrationStateSchema, { open: true, close_at: 0 }).success).toBe(true);
    expect(v.safeParse(RegistrationStateSchema, { open: false, close_at: -1 }).success).toBe(false);
  });
});
