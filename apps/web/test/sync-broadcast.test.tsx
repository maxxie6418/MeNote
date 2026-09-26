// @vitest-environment jsdom
/**
 * 跨标签页广播（M2-9 验收点）：
 * - 只发"哪条变了/游标到哪"，**不带用户内容**；
 * - 只认自己发的那种消息形状（别的脚本往同名通道发东西不会误触发）；
 * - 环境没有 BroadcastChannel（如 jsdom）时降级为空实现，不报错；
 * - 引擎在推送成功或拉取落库后广播、跨页收到后回调 `onRemoteChange`；
 *   本页自己的同步**不**触发自己的回调。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createSyncChannel,
  SYNC_CHANNEL_NAME,
  type ChannelLike,
} from "../src/data/sync/broadcast";

interface FakeChannel extends ChannelLike {
  name: string;
  posted: unknown[];
  closed: boolean;
  listener: ((event: { data: unknown }) => void) | null;
}

function fakeFactory(store: FakeChannel[] = []) {
  const channels = store;
  return (name: string): FakeChannel => {
    const channel = {
      name,
      posted: [] as unknown[],
      closed: false as boolean,
      listener: null as ((event: { data: unknown }) => void) | null,
      postMessage(data: unknown) {
        channel.posted.push(data);
      },
      close() {
        channel.closed = true;
      },
      addEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
        channel.listener = listener;
      },
      removeEventListener() {
        channel.listener = null;
      },
    } satisfies FakeChannel;
    channels.push(channel);
    return channel;
  };
}

describe("广播通道", () => {
  it("投递与订阅：只透传认得的事件形状", () => {
    const channels: FakeChannel[] = [];
    const channel = createSyncChannel({ createChannel: fakeFactory(channels) });
    const seen: unknown[] = [];
    channel.subscribe((event) => seen.push(event));

    channel.post({ kind: "item-updated", itemId: "a" });
    expect(channels[0]?.posted).toEqual([{ kind: "item-updated", itemId: "a" }]);

    // 外来消息（形状不对）不触发回调
    channels[0]?.listener?.({ data: { hello: "world" } });
    channels[0]?.listener?.({ data: null });
    channels[0]?.listener?.({ data: { kind: "item-updated" } });
    expect(seen).toEqual([]);

    // 认得的事件才透传
    channels[0]?.listener?.({ data: { kind: "item-updated", itemId: "b" } });
    channels[0]?.listener?.({ data: { kind: "cursor-advanced", cursor: 7 } });
    expect(seen).toEqual([
      { kind: "item-updated", itemId: "b" },
      { kind: "cursor-advanced", cursor: 7 },
    ]);
  });

  it("通道名带应用前缀（不与其它应用撞名）", () => {
    const channels: FakeChannel[] = [];
    createSyncChannel({ createChannel: fakeFactory(channels) });
    expect(channels[0]?.name).toBe(SYNC_CHANNEL_NAME);
    expect(SYNC_CHANNEL_NAME).toContain("menote");
  });

  it("取消订阅后不再回调；close 会关闭底层通道", () => {
    const channels: FakeChannel[] = [];
    const channel = createSyncChannel({ createChannel: fakeFactory(channels) });
    const handler = vi.fn();
    const off = channel.subscribe(handler);

    off();
    expect(channels[0]?.listener).toBeNull();

    channel.close();
    expect(channels[0]?.closed).toBe(true);
  });

  it("环境不支持 BroadcastChannel 时降级为空实现（不抛错）", () => {
    const channel = createSyncChannel({ createChannel: () => null });
    const handler = vi.fn();

    expect(() => channel.post({ kind: "cursor-advanced", cursor: 1 })).not.toThrow();
    const off = channel.subscribe(handler);
    expect(typeof off).toBe("function");
    off();
    channel.close();
    expect(handler).not.toHaveBeenCalled();
  });

  it("jsdom 里默认走空实现（说明真实浏览器才有广播）", () => {
    // jsdom 不实现 BroadcastChannel；这条用例把"降级不报错"钉在真实默认路径上
    const channel = createSyncChannel();
    expect(() => channel.post({ kind: "item-updated", itemId: "x" })).not.toThrow();
  });
});
