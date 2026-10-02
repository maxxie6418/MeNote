// @vitest-environment jsdom
/**
 * 分享查看器（M5-S3）用例。四态：失效 / 无密码直通 / 密码（错与对）/ 附件改写。
 * 公开接口全走 fetch，所以用替身按 URL 分派（`unlockAnswers` 让「先错后对」可表达）。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseShareId } from "../src/features/share-viewer/model";
import { ShareViewerApp } from "../src/features/share-viewer/ui/ShareViewerApp";

const SID = "AAAAAAAAAAAAAAAAAAAAAA";
const SHA = "a".repeat(64);

interface Mock {
  status: unknown;
  /** 依次返回（第一次 unlock 拿 wrong_password，第二次放行） */
  unlockAnswers?: unknown[];
  content?: unknown;
  attachmentOk?: boolean;
}

function installFetch(mock: Mock): void {
  // 依次取（第一次 wrong_password、第二次放行）：shift 把答案逐个用掉
  const unlockAnswers = [...(mock.unlockAnswers ?? [{ status: "invalid" }])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      const json = (value: unknown, status = 200): Response =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/unlock")) {
        return json(unlockAnswers.length > 1 ? unlockAnswers.shift() : unlockAnswers[0]);
      }
      if (url.endsWith("/content")) {
        if (!mock.content) return json({ code: "invalid", message: "没有内容" }, 422);
        return json(mock.content);
      }
      if (url.includes("/att/")) {
        return mock.attachmentOk
          ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
          : json({ code: "not_found" }, 404);
      }
      return json(mock.status);
    }),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", `/s/${SID}`);
  // jsdom 没有 createObjectURL；查看器用它承接附件字节
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:mock/1", revokeObjectURL: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("parseShareId", () => {
  it("只认 `/s/<22 位 base64url>`；别的路径一律 null（主应用路径不误触）", () => {
    expect(parseShareId(`/s/${SID}`)).toBe(SID);
    expect(parseShareId(`/s/${SID}/`)).toBe(SID);
    expect(parseShareId("/notes")).toBeNull();
    expect(parseShareId("/s/short")).toBeNull();
  });
});

describe("查看器", () => {
  it("链接失效：一屏说清，不留操作入口", async () => {
    installFetch({ status: { status: "invalid", requires_password: false } });
    render(<ShareViewerApp />);
    await waitFor(() => {
      expect(screen.getByText("链接已失效")).toBeTruthy();
    });
  });

  it("无密码：状态 → unlock → 正文渲染，附件链接改写成 object URL", async () => {
    installFetch({
      status: { status: "ok", requires_password: false, kind: "item" },
      unlockAnswers: [{ status: "ok", token: "tok" }],
      content: {
        kind: "item",
        item: {
          id: "i1",
          type: "note",
          title: "共享的笔记",
          body: `正文一行\n\n![](/api/attachments/h/${SHA})`,
          updated_at: 1,
        },
      },
      attachmentOk: true,
    });
    render(<ShareViewerApp />);
    await waitFor(() => {
      expect(screen.getByText("共享的笔记")).toBeTruthy();
    });
    expect(document.body.textContent).toContain("正文一行");
    // 浏览器发不了自定义头，图片必须先取字节再改写成 blob
    await waitFor(() => {
      expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:mock/1");
    });
  });

  it("有密码：错密码提示「密码不对」，不泄露出链接已失效", async () => {
    const user = userEvent.setup();
    installFetch({
      status: {
        status: "ok",
        requires_password: true,
        kind: "item",
        salt: "c2FsdA",
        kdf: { alg: "PBKDF2-SHA256", iterations: 100_000 },
      },
      unlockAnswers: [{ status: "wrong_password" }],
    });
    render(<ShareViewerApp />);
    await waitFor(() => {
      expect(screen.getByText("这条分享需要密码")).toBeTruthy();
    });
    await user.type(screen.getByLabelText("访问密码"), "错的密码");
    await user.click(screen.getByText("打开"));
    await waitFor(
      () => {
        expect(screen.getByText("密码不对")).toBeTruthy();
      },
      { timeout: 15_000 },
    );
  });
});
