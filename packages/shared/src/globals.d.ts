/**
 * TextEncoder / TextDecoder 的最小环境声明。
 *
 * 这两个是 WHATWG Encoding 标准的一部分，浏览器、Worker、Node 都原生提供；这里只声明本项目
 * 用到的成员，避免为了类型给 `packages/shared` 引入 DOM lib —— 那会让本包可以误用
 * `window` / `document` 等浏览器专有 API，破坏「两端都能跑」的约束（架构 §2.3）。
 *
 * 本文件不导出任何东西，也不被 `dist/index.d.ts` 引用，因此不会泄漏给消费方。
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string);
  decode(input?: Uint8Array): string;
}

/** WebCrypto 的最小声明（浏览器 / Worker 都提供；只声明本项目用到的成员） */
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;
  };
};
