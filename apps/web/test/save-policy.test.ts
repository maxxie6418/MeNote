import {
  AUTOSAVE_IDLE_MS,
  AUTOSAVE_LARGE_IDLE_MS,
  AUTOSAVE_LARGE_MAX_MS,
  AUTOSAVE_MAX_MS,
  BODY_HARD_LIMIT_BYTES,
  BODY_SOFT_LIMIT_BYTES,
  LARGE_DOC_THRESHOLD_BYTES,
} from "@menote/shared";
import { describe, expect, it } from "vitest";
import {
  decideAutosave,
  formatSize,
  sizeLevel,
  uploadTiming,
} from "../src/app/editor/save-policy";

describe("大小档位", () => {
  it("1 MB 以内正常；超过软上限提示；达到硬上限阻止", () => {
    expect(sizeLevel(0)).toBe("ok");
    expect(sizeLevel(BODY_SOFT_LIMIT_BYTES)).toBe("ok");
    expect(sizeLevel(BODY_SOFT_LIMIT_BYTES + 1)).toBe("soft");
    expect(sizeLevel(BODY_HARD_LIMIT_BYTES - 1)).toBe("soft");
    expect(sizeLevel(BODY_HARD_LIMIT_BYTES)).toBe("hard");
    expect(sizeLevel(BODY_HARD_LIMIT_BYTES + 1)).toBe("hard");
  });

  it("状态栏文案形如 “1.2 MB / 2 MB”", () => {
    expect(formatSize(0)).toBe("0.0 MB / 2 MB");
    expect(formatSize(1_258_291)).toBe("1.2 MB / 2 MB");
  });
});

describe("上传节奏", () => {
  it("小文档 2 秒 / 30 秒；超过 256 KB 放宽为 5 秒 / 60 秒", () => {
    expect(uploadTiming(0)).toEqual({ idleMs: AUTOSAVE_IDLE_MS, maxMs: AUTOSAVE_MAX_MS });
    expect(uploadTiming(LARGE_DOC_THRESHOLD_BYTES)).toEqual({
      idleMs: AUTOSAVE_IDLE_MS,
      maxMs: AUTOSAVE_MAX_MS,
    });
    expect(uploadTiming(LARGE_DOC_THRESHOLD_BYTES + 1)).toEqual({
      idleMs: AUTOSAVE_LARGE_IDLE_MS,
      maxMs: AUTOSAVE_LARGE_MAX_MS,
    });
  });
});

describe("自动保存决策", () => {
  const base = { bytes: 100, dirty: true, msSinceChange: 0, msSinceUpload: 0 };

  it("没有改动时什么都不做", () => {
    expect(decideAutosave({ ...base, dirty: false })).toEqual({
      writeDraft: false,
      enqueueUpload: false,
      blockedByHardLimit: false,
    });
  });

  it("有改动就先写草稿；停止输入满 2 秒才上传", () => {
    expect(decideAutosave({ ...base, msSinceChange: 1_999 })).toEqual({
      writeDraft: true,
      enqueueUpload: false,
      blockedByHardLimit: false,
    });
    expect(decideAutosave({ ...base, msSinceChange: 2_000 }).enqueueUpload).toBe(true);
  });

  it("持续输入时最长 30 秒一次（按距上次上传的时间）", () => {
    expect(
      decideAutosave({ ...base, msSinceChange: 10, msSinceUpload: 29_999 }).enqueueUpload,
    ).toBe(false);
    expect(
      decideAutosave({ ...base, msSinceChange: 10, msSinceUpload: 30_000 }).enqueueUpload,
    ).toBe(true);
  });

  it("大文档按 5 秒 / 60 秒", () => {
    const large = { ...base, bytes: LARGE_DOC_THRESHOLD_BYTES + 1 };
    expect(decideAutosave({ ...large, msSinceChange: 4_999 }).enqueueUpload).toBe(false);
    expect(decideAutosave({ ...large, msSinceChange: 5_000 }).enqueueUpload).toBe(true);
    expect(decideAutosave({ ...large, msSinceChange: 0, msSinceUpload: 59_999 }).enqueueUpload).toBe(
      false,
    );
    expect(decideAutosave({ ...large, msSinceChange: 0, msSinceUpload: 60_000 }).enqueueUpload).toBe(
      true,
    );
  });

  it("达到硬上限：草稿照写，但不上传（本地保留直到用户删减）", () => {
    const decision = decideAutosave({
      bytes: BODY_HARD_LIMIT_BYTES,
      dirty: true,
      msSinceChange: 60_000,
      msSinceUpload: 60_000,
    });
    expect(decision).toEqual({
      writeDraft: true,
      enqueueUpload: false,
      blockedByHardLimit: true,
    });
  });
});
