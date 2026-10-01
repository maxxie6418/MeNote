/**
 * 备份格式契约的用例（`docs/modules/Menote-M5-备份与导出-设计-v1.md`）。
 *
 * 重点不是"正常包能解析"，而是**坏包一律被拒收**：备份是用户唯一的救命资产，
 * 半截包被当成完整快照恢复，代价远大于"这次恢复失败"。所以每一条拒收路径都要有用例。
 */
import { describe, expect, it } from "vitest";
import {
  ATTACHMENTS_DIR,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  COMPLETE_NAME,
  MANIFEST_NAME,
  NOTES_DIR,
  SNAPSHOT_DIR,
  attachmentPath,
  isSafeSegment,
  normalizeSnapshotPath,
  notePath,
  parseComplete,
  renderComplete,
  verifySnapshot,
  type BackupManifest,
} from "../src/backup";
import { sha256Hex } from "../src/hash";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

function manifestOf(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: "0.6.8",
    exported_at: "2026-10-01T12:00:00.000Z",
    items: [],
    attachments: [],
    include_trashed: true,
    include_versions: false,
    ...overrides,
  };
}

async function completeFor(manifestText: string): Promise<string> {
  return renderComplete(BACKUP_VERSION, await sha256Hex(new TextEncoder().encode(manifestText)));
}

describe("备份：包内固定名与路径", () => {
  it("固定名是契约——改名会让已产出的备份全部失效", () => {
    expect(SNAPSHOT_DIR).toBe("snapshot");
    expect(MANIFEST_NAME).toBe("manifest.json");
    expect(COMPLETE_NAME).toBe("COMPLETE");
    expect(NOTES_DIR).toBe("notes");
    expect(ATTACHMENTS_DIR).toBe("attachments");
  });

  it("附件按内容寻址：同一张图被十篇引用只存一份，改名也不影响去重", () => {
    expect(attachmentPath(SHA, "照片.png")).toBe(`attachments/${SHA}--照片.png`);
  });

  it("附件 sha256 或文件名不合法就抛错（文件名是路径穿越的第二条入口）", () => {
    expect(() => attachmentPath("nothex", "a.png")).toThrow();
    expect(() => attachmentPath(SHA, "../../evil.png")).toThrow();
    expect(() => attachmentPath(SHA, "a/b.png")).toThrow();
    expect(() => attachmentPath(SHA, "")).toThrow();
  });

  it("条目正文一篇一个文件，id 即文件名", () => {
    expect(notePath("01ABC")).toBe("notes/01ABC.md");
    expect(() => notePath("../evil")).toThrow();
  });
});

describe("备份：路径归一化与穿越拒绝", () => {
  it("正常路径原样通过", () => {
    expect(normalizeSnapshotPath("snapshot/notes/a.md")).toBe("snapshot/notes/a.md");
  });

  it("冗余的 `./` 与空段被去掉，`.` 段不是穿越", () => {
    expect(normalizeSnapshotPath("snapshot//notes/./a.md")).toBe("snapshot/notes/a.md");
  });

  it("`..` 段一律拒收", () => {
    expect(() => normalizeSnapshotPath("snapshot/../etc/passwd")).toThrow();
    expect(() => normalizeSnapshotPath("snapshot/notes/../../a.md")).toThrow();
  });

  it("绝对路径与 Windows 盘符拒收", () => {
    expect(() => normalizeSnapshotPath("/etc/passwd")).toThrow();
    expect(() => normalizeSnapshotPath("C:/Windows/system32")).toThrow();
  });

  it("反斜杠拒收（Windows 上 `..\\` 是最常见的穿越写法）", () => {
    expect(() => normalizeSnapshotPath("snapshot\\notes\\a.md")).toThrow();
  });

  it("控制字符与 DEL 拒收", () => {
    expect(() => normalizeSnapshotPath(`snapshot/no${String.fromCharCode(10)}tes/a.md`)).toThrow();
    expect(() => normalizeSnapshotPath(`snapshot/n${String.fromCharCode(0)}tes/a.md`)).toThrow();
    expect(() => normalizeSnapshotPath(`snapshot/n${String.fromCharCode(127)}tes/a.md`)).toThrow();
  });

  it("必须落在 snapshot/ 内", () => {
    expect(() => normalizeSnapshotPath("etc/passwd")).toThrow();
    expect(() => normalizeSnapshotPath("snapshotx/notes/a.md")).toThrow();
  });

  it("空路径与只剩分隔符的路径拒收", () => {
    expect(() => normalizeSnapshotPath("")).toThrow();
    expect(() => normalizeSnapshotPath("/")).toThrow();
  });

  it("isSafeSegment：单段的把关与整条路径不同（单段可以有点，路径不行）", () => {
    expect(isSafeSegment("照片.png")).toBe(true);
    expect(isSafeSegment("a.md")).toBe(true);
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment("a/b")).toBe(false);
    expect(isSafeSegment("")).toBe(false);
  });
});

describe("备份：COMPLETE 提交标记", () => {
  it("渲染出来的是两行纯文本，格式标识 + manifest 的 sha256", () => {
    expect(renderComplete(1, SHA)).toBe(`menote-backup v1\nmanifest-sha256 ${SHA}\n`);
  });

  it("渲染时就挡住非法 sha256", () => {
    expect(() => renderComplete(1, "nope")).toThrow();
  });

  it("解析回来是原样的一对数", () => {
    expect(parseComplete(renderComplete(1, SHA))).toEqual({
      version: 1,
      manifestSha256: SHA,
    });
  });

  it("认不出来的内容返回 null，而不是抛错——「不是我们的备份」不是错误", () => {
    expect(parseComplete("")).toBeNull();
    expect(parseComplete("随便一段文字")).toBeNull();
    expect(parseComplete(`menote-backup v1\nmanifest-sha256 ${SHA}\n\n\n`)).toBeNull();
    expect(parseComplete(`menote-backup v1\nsha256 ${SHA}\n`)).toBeNull();
    expect(parseComplete(`menote-backup v1\nmanifest-sha256 ${SHA.toUpperCase()}\n`)).toBeNull();
  });

  it("末尾换行可有可无、CRLF 也认——有些工具会剥掉它，不该因此作废一份备份", () => {
    const withoutNewline = `menote-backup v1\nmanifest-sha256 ${SHA}`;
    const crlf = `menote-backup v1\r\nmanifest-sha256 ${SHA}\r\n`;
    expect(parseComplete(withoutNewline)).toEqual({ version: 1, manifestSha256: SHA });
    expect(parseComplete(crlf)).toEqual({ version: 1, manifestSha256: SHA });
  });
});

describe("备份：整包校验", () => {
  it("完整包过：manifest 与 COMPLETE 对得上", async () => {
    const manifestText = JSON.stringify(manifestOf());
    const completeText = await completeFor(manifestText);
    const parsed = await verifySnapshot({ completeText, manifestText });
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.items).toEqual([]);
  });

  it("缺 COMPLETE 拒收", async () => {
    const manifestText = JSON.stringify(manifestOf());
    await expect(verifySnapshot({ completeText: "", manifestText })).rejects.toThrow(/COMPLETE/);
  });

  it("哈希对不上拒收（半截包最典型的形态）", async () => {
    const manifestText = JSON.stringify(manifestOf());
    const completeText = renderComplete(BACKUP_VERSION, OTHER_SHA);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/不完整/);
  });

  it("比程序新的版本拒收，并提示先升级", async () => {
    const newer = BACKUP_VERSION + 1;
    const manifestText = JSON.stringify(manifestOf({ version: newer }));
    // 关键是 COMPLETE 里写的就是新版本号：版本判断读的是标记，不是 manifest
    const completeText = renderComplete(newer, await sha256Hex(new TextEncoder().encode(manifestText)));
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/升级/);
  });

  it("标记写 v1、manifest 声称 v2：按 v1 规则读那些不认识的字段是危险的，拒收", async () => {
    const manifestText = JSON.stringify(manifestOf({ version: BACKUP_VERSION + 1 }));
    const completeText = await completeFor(manifestText);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/升级/);
  });

  it("标记与 manifest 版本号不一致：说明包被动过手，拒收", async () => {
    const manifestText = JSON.stringify(manifestOf({ version: 1 }));
    // 标记却写成 v0（比程序旧），两者对不上
    const completeText = renderComplete(0, await sha256Hex(new TextEncoder().encode(manifestText)));
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/不一致/);
  });

  it("不是合法 JSON 拒收", async () => {
    const manifestText = "{ 这不是 json";
    const completeText = await completeFor(manifestText);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/JSON/);
  });

  it("结构不合法拒收", async () => {
    const manifestText = JSON.stringify({ format: BACKUP_FORMAT });
    const completeText = await completeFor(manifestText);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/结构不合法/);
  });

  it("格式标识对不上拒收（别人做的备份不能硬读）", async () => {
    const manifestText = JSON.stringify({ ...manifestOf(), format: "something-else" });
    const completeText = await completeFor(manifestText);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow(/结构不合法/);
  });

  it("条目路径越界会在校验期就被拒——不会等到读盘才炸", async () => {
    const manifestText = JSON.stringify(
      manifestOf({
        items: [
          {
            path: "snapshot/../../etc/passwd",
            id: "a",
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
            content_hash: SHA,
            size_bytes: 0,
            rev: 0,
            created_at: 0,
            updated_at: 0,
            deleted_at: null,
          },
        ],
      }),
    );
    const completeText = await completeFor(manifestText);
    await expect(verifySnapshot({ completeText, manifestText })).rejects.toThrow();
  });

  it("哈希算的是读到的原始字节：manifest 改一个空格就拒收", async () => {
    const original = JSON.stringify(manifestOf());
    const completeText = await completeFor(original);
    const tampered = original.replace('"app_version":"0.6.8"', '"app_version": "0.6.8"');
    expect(tampered).not.toBe(original);
    await expect(verifySnapshot({ completeText, manifestText: tampered })).rejects.toThrow(/不完整/);
  });
});
