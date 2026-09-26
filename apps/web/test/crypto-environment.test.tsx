// @vitest-environment jsdom
/**
 * 加密能力环境自检与诊断文案（起因见 `cryptoEnvironment.ts`）：
 * 云端出现过"用 https 打开，却提示是 http"的误判——提示写死了原因，而真实原因可能是
 * 证书警告被跳过、页面被嵌在 http 的 iframe 里、或浏览器过旧。所以这里既测"探测到的环境"，
 * 也测"文案必须把观测到的事实说出来、且不能臆断协议"。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsecureContextBanner } from "../src/app/ui/InsecureContextBanner";
import {
  describeCryptoEnvironment,
  hasWebCrypto,
  httpsUpgradeUrl,
  inspectCryptoEnvironment,
  type CryptoEnvironment,
} from "../src/app/ui/cryptoEnvironment";

/** 造一个"看起来像在某个地址上"的环境（jsdom 的 location 改不动，用假的环境对象即可） */
function envAt(href: string, overrides: Partial<CryptoEnvironment> = {}): CryptoEnvironment {
  const url = new URL(href);
  return {
    secure: false,
    protocol: url.protocol,
    href,
    hasSubtle: false,
    reason: "测试用",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("环境自检", () => {
  it("正常环境：安全上下文 + WebCrypto 都有", () => {
    const env = inspectCryptoEnvironment();
    expect(env.secure).toBe(true);
    expect(env.hasSubtle).toBe(true);
    expect(describeCryptoEnvironment(env)).toContain("安全上下文 是");
  });

  it("非安全上下文（isSecureContext = false）能被探到，且原因是该协议下对应的那一条", () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const env = inspectCryptoEnvironment();

    expect(env.secure).toBe(false);
    // jsdom 的 location.protocol 是 http:，因此应命中"用 http 打开"这一条；
    // "https 但仍被判非安全"由下面的显式环境用例覆盖
    if (env.protocol === "http:") {
      expect(env.reason).toContain("改用 https");
    } else {
      expect(env.reason).toContain("非安全上下文");
    }

    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  it("crypto.subtle 缺失时 hasWebCrypto 为 false", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: original.getRandomValues.bind(original) });
    expect(hasWebCrypto()).toBe(false);
    expect(inspectCryptoEnvironment().hasSubtle).toBe(false);
  });

  it("诊断串包含地址、协议、安全上下文与 WebCrypto 四项事实", () => {
    const text = describeCryptoEnvironment({
      secure: false,
      protocol: "https:",
      href: "https://me.example/app",
      hasSubtle: false,
      reason: "测试用",
    });
    expect(text).toContain("https://me.example/app");
    expect(text).toContain("协议 https:");
    expect(text).toContain("安全上下文 否");
    expect(text).toContain("WebCrypto 缺失");
  });
});

describe("http 兜底升级到 https", () => {
  // jsdom 里 location 固定是 http://localhost:3000，所以"公网域名"的用例通过改写 location 来造；
  // 这里用一个最小替身，避免动 jsdom 的 location 实现。
  function withLocation(href: string, run: () => void): void {
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL(href),
    });
    try {
      run();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  }

  it("http 的公网域名：升级为 https，并保留路径 / 查询串 / hash", () => {
    withLocation("http://me.861306.xyz/app?x=1#/login", () => {
      expect(httpsUpgradeUrl(envAt("http://me.861306.xyz/app?x=1#/login"))).toBe(
        "https://me.861306.xyz/app?x=1#/login",
      );
    });
  });

  it("已经在 https：不动", () => {
    withLocation("https://me.861306.xyz/#/login", () => {
      expect(httpsUpgradeUrl(envAt("https://me.861306.xyz/#/login", { secure: true }))).toBeNull();
    });
  });

  it("本地与局域网不升级（那些环境没有 TLS，跳过去更糟）", () => {
    for (const href of [
      "http://localhost:5173/",
      "http://127.0.0.1:5173/",
      "http://192.168.1.9:5173/",
      "http://nas.local/",
      "http://intranet/", // 单标签主机名
    ]) {
      withLocation(href, () => {
        expect(httpsUpgradeUrl(envAt(href))).toBeNull();
      });
    }
  });

  it("localhost 下 http 也是安全上下文：能用就不跳", () => {
    withLocation("http://localhost:5173/", () => {
      expect(httpsUpgradeUrl(envAt("http://localhost:5173/", { secure: true, hasSubtle: true }))).toBeNull();
    });
  });
});

describe("常驻警告", () => {
  it("https 下被判非安全上下文时：不写死 http，而是把事实显示出来", () => {
    render(
      <InsecureContextBanner
        environment={{
          secure: false,
          protocol: "https:",
          href: "https://me.example/app",
          hasSubtle: false,
          reason: "浏览器把这个页面判为非安全上下文（即使协议是 https）。",
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("无法登录、注册或保存笔记");
    expect(alert.textContent).toContain("https://me.example/app");
    expect(alert.textContent).toContain("安全上下文 否");
    // 诊断信息在等宽片段里，便于用户原样反馈
    expect(alert.querySelector("code")?.textContent).toContain("WebCrypto 缺失");
  });

  it("显式 secure=false 时必定渲染；secure=true 时不渲染", () => {
    const { rerender } = render(<InsecureContextBanner secure={false} />);
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<InsecureContextBanner secure />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
