/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 保存正文时对齐附件引用集合（M6 第一批 · 批 2a；`X-Menote-Refs` 头）。
 *
 * **为什么这组用例值得单独一个文件**：它盯的不是「附件接口能不能用」，而是**引用表与正文
 * 会不会漂**。孤儿判定只看 `attachment_refs`——一旦对不上，那张**仍在正文里显示**的图会被
 * 标成孤儿，**30 天后由每日维护真删掉 R2 对象**，笔记里的图凭空消失。这类 bug 不会报错、
 * 不会变红，只会在一个月后以「图没了」的形式出现。
 *
 * 顺带**第一条就是 `json_each` 的探针**：新 SQL 用它把整个 sha 数组压成一个绑定参数
 * （D1 单条语句的绑定参数上限比 SQLite 严，逐行绑定会被顶爆）。此前只是推测 D1 默认启用
 * JSON1，现在让这条用例把话说出来。
 *
 * 另外单列一个文件还有个实操原因：`attachments.test.ts` 已经贴着 500 行的 ESLint 预算
 * （架构 §2.3.3），再往里塞就会破门禁。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  ITEM_REFS_HEADER,
  base64UrlEncodeUtf8,
  encodeAttachmentRefs,
  newUlid,
  sha256Hex,
} from "@menote/shared";
import { SQL_UPSERT_ITEM_BODY } from "../src/db/tables";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
    ...extra,
  };
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncodeUtf8(String.fromCharCode(...bytes));
}

let seed = 30;
async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
  seed += 1;
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: headers(""),
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: headers(cookie) });
  const { id } = (await me.json()) as { id: string };
  return { cookie, id };
}

/** 第二个及以后的账号要先开注册（首位注册者即 owner，注册默认关） */
async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

/** 造一个"哈希对得上"的假文件（内容随便，哈希由测试给） */
function fakeSha(seedText: string): string {
  return seedText.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");
}

/** 直接落库造一条可保存的条目（与 shares.test.ts 的 insertItem 同一手法） */
async function insertItem(userId: string, id: string, body: string): Promise<void> {
  const hash = await sha256Hex(body);
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at)
     VALUES (?, ?, 'note', '引用对齐样例', 0, 0, ?, ?, '[]', 0, 0, 0, 1, 1, 1, 1, 1)`,
  )
    .bind(id, userId, body.length, hash)
    .run();
  await env.DB.prepare(SQL_UPSERT_ITEM_BODY).bind(id, body, id, userId, 1, hash).run();
}

/** 上传并 finalize；给了 `itemId` 就顺便按 M4 的老口径挂一条「当前稿引用」 */
async function uploadAndFinalize(
  cookie: string,
  sha: string,
  withThumb: boolean,
  itemId: string | null = null,
): Promise<{ attachmentId: string; thumbId: string | null }> {
  const bytes = new Uint8Array([1, 2, 3]);
  const put = async (kind: string, payload: Uint8Array): Promise<void> => {
    const res = await SELF.fetch(
      `${ORIGIN}/api/attachments/blob?sha256=${sha}&kind=${kind}`,
      { method: "PUT", headers: headers(cookie, { "Content-Type": "image/png" }), body: payload },
    );
    expect(res.status).toBe(200);
  };
  await put("original", bytes);
  if (withThumb) await put("thumb", new Uint8Array([9]));

  const res = await SELF.fetch(`${ORIGIN}/api/attachments/finalize`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({
      sha256: sha,
      size: 3,
      mime: "image/png",
      width: 10,
      height: 10,
      filename: "a.png",
      itemId,
      thumb: withThumb ? { size: 1, mime: "image/webp", width: 4, height: 4 } : null,
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { attachmentId: string; thumbId: string | null };
}

/** 保存正文；`refs` 为 `undefined` 表示**不带** `X-Menote-Refs` 这个头 */
async function saveBody(
  cookie: string,
  itemId: string,
  body: string,
  refs?: string[],
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${itemId}/body`, {
    method: "PUT",
    headers: headers(cookie, {
      "If-Match": "1",
      "X-Menote-Hash": await sha256Hex(body),
      ...(refs === undefined ? {} : { [ITEM_REFS_HEADER]: encodeAttachmentRefs(refs) }),
    }),
    body,
  });
}

async function draftRefIds(itemId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT attachment_id FROM attachment_refs WHERE item_id = ? AND version_id IS NULL",
  )
    .bind(itemId)
    .all<{ attachment_id: string }>();
  return rows.results.map((r) => r.attachment_id);
}

beforeEach(async () => {
  await freshDatabase();
});

describe("保存正文时对齐引用集合（X-Menote-Refs）", () => {
  it("带 refs 保存：引用集合换成新的（D1 支持 json_each，数组只占一个绑定参数）", async () => {
    const user = await registerUser("RefsA");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");

    const a = await uploadAndFinalize(user.cookie, fakeSha("a"), false);
    const b = await uploadAndFinalize(user.cookie, fakeSha("b"), false);

    const body =
      "第二版\n\n![a](/api/attachments/h/" +
      fakeSha("a") +
      ")\n\n![b](/api/attachments/h/" +
      fakeSha("b") +
      ")";
    expect((await saveBody(user.cookie, itemId, body, [fakeSha("a"), fakeSha("b")])).status).toBe(200);
    expect((await draftRefIds(itemId)).sort()).toEqual([a.attachmentId, b.attachmentId].sort());
  });

  it("不带这个头：引用表一个字都不动（向后兼容的硬断言）", async () => {
    const user = await registerUser("RefsB");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    await uploadAndFinalize(user.cookie, fakeSha("c"), false, itemId);

    expect((await draftRefIds(itemId)).length).toBe(1);

    // 不带 refs 保存（即使正文里已经没有那张图了）
    expect((await saveBody(user.cookie, itemId, "第二版，没有图了")).status).toBe(200);
    expect((await draftRefIds(itemId)).length).toBe(1); // 仍然一条没少
  });

  it("带空数组：清空当前稿的引用", async () => {
    const user = await registerUser("RefsC");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    await uploadAndFinalize(user.cookie, fakeSha("d"), false, itemId);

    expect((await saveBody(user.cookie, itemId, "第二版，没有图了", [])).status).toBe(200);
    expect(await draftRefIds(itemId)).toEqual([]);
  });

  it("只挂原图、不挂缩略图（两行共用同一 sha256，不过滤 kind 就会重复）", async () => {
    const user = await registerUser("RefsD");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    const withThumb = await uploadAndFinalize(user.cookie, fakeSha("f"), true);
    expect(withThumb.thumbId).not.toBeNull();

    expect((await saveBody(user.cookie, itemId, "第二版", [fakeSha("f")])).status).toBe(200);
    expect(await draftRefIds(itemId)).toEqual([withThumb.attachmentId]);
  });

  it("sha 查不到对应附件：跳过、不报错，其余正常写入", async () => {
    const user = await registerUser("RefsE");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    const a = await uploadAndFinalize(user.cookie, fakeSha("1"), false);

    // 服务端没有 fakeSha("9") 这个附件
    expect((await saveBody(user.cookie, itemId, "第二版", [fakeSha("9"), fakeSha("1")])).status).toBe(200);
    expect(await draftRefIds(itemId)).toEqual([a.attachmentId]);
  });

  it("历史版本的引用（version_id 非 NULL）不被清掉", async () => {
    const user = await registerUser("RefsF");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    const a = await uploadAndFinalize(user.cookie, fakeSha("2"), false);
    const b = await uploadAndFinalize(user.cookie, fakeSha("3"), false);

    const versionId = newUlid();
    await env.DB.prepare(
      "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES (?, ?, ?, 1)",
    )
      .bind(itemId, versionId, b.attachmentId)
      .run();

    expect((await saveBody(user.cookie, itemId, "第二版", [fakeSha("2")])).status).toBe(200);

    // 当前稿只剩 a
    expect(await draftRefIds(itemId)).toEqual([a.attachmentId]);
    // b 的那条属于历史版本，原样留着（回滚那个版本时图还在）
    const kept = await env.DB.prepare(
      "SELECT attachment_id FROM attachment_refs WHERE item_id = ? AND version_id = ?",
    )
      .bind(itemId, versionId)
      .all<{ attachment_id: string }>();
    expect(kept.results.map((r) => r.attachment_id)).toEqual([b.attachmentId]);
  });

  it("跨租户：B 用户的 sha 传进 A 的条目不写入", async () => {
    const alice = await registerUser("RefsG");
    await openRegistration(alice.cookie);
    const bob = await registerUser("RefsH");
    const itemId = newUlid();
    await insertItem(alice.id, itemId, "第一版");
    const bobs = await uploadAndFinalize(bob.cookie, fakeSha("5"), false);

    expect((await saveBody(alice.cookie, itemId, "第二版", [fakeSha("5")])).status).toBe(200);
    expect(await draftRefIds(itemId)).not.toContain(bobs.attachmentId);
  });

  it("refs 头非法：422，而不是静默忽略", async () => {
    const user = await registerUser("RefsI");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    const body = "第二版";

    const res = await SELF.fetch(`${ORIGIN}/api/items/${itemId}/body`, {
      method: "PUT",
      headers: headers(user.cookie, {
        "If-Match": "1",
        "X-Menote-Hash": await sha256Hex(body),
        [ITEM_REFS_HEADER]: base64UrlEncodeUtf8(JSON.stringify(["不是哈希"])),
      }),
      body,
    });
    expect(res.status).toBe(422);
  });

  it("批量路径同样对齐引用（离线主路径，漏了就等于没做）", async () => {
    const user = await registerUser("RefsJ");
    const itemId = newUlid();
    await insertItem(user.id, itemId, "第一版");
    const a = await uploadAndFinalize(user.cookie, fakeSha("7"), false);

    const body = "第二版 ![a](/api/attachments/h/" + fakeSha("7") + ")";
    const res = await SELF.fetch(`${ORIGIN}/api/batch`, {
      method: "POST",
      headers: headers(user.cookie),
      body: JSON.stringify({
        ops: [
          {
            kind: "save_body",
            id: itemId,
            base_rev: 1,
            content_hash: await sha256Hex(body),
            body,
            refs: [fakeSha("7")],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const results = (await res.json()) as { results: { ok: boolean }[] };
    expect(results.results[0]?.ok).toBe(true);
    expect(await draftRefIds(itemId)).toEqual([a.attachmentId]);
  });
});
