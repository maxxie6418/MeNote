import { describe, expect, it } from "vitest";
import {
  bigramFallback,
  buildSearchText,
  makeSnippet,
  mergeBy,
  searchRows,
  tokenize,
  type SearchableRow,
} from "../src/features/search/model";

function row(itemId: string, text: string, updatedAt = 1): SearchableRow {
  return {
    item_id: itemId,
    text,
    haystack: text.toLowerCase(),
    tokens: tokenize(text).join(" "),
    updated_at: updatedAt,
  };
}

describe("分词", () => {
  it("中文按词切分（Intl.Segmenter 可用时）", () => {
    expect(tokenize("今天开会讨论方案")).toContain("开会");
  });

  it("英文与数字按词切分，标点丢弃", () => {
    const tokens = tokenize("Deploy 2026-09-26, done!");
    expect(tokens).toContain("deploy");
    expect(tokens).toContain("2026");
    expect(tokens).not.toContain(",");
  });

  it("空串与纯标点没有词", () => {
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("。。。！")).toEqual([]);
  });

  it("退化分词：中文连续段取二元组，单字保留", () => {
    expect(bigramFallback("笔记")).toEqual(["笔记"]);
    expect(bigramFallback("写笔记")).toEqual(["写笔", "笔记"]);
    expect(bigramFallback("猫")).toEqual(["猫"]);
    expect(bigramFallback("Menote 笔记")).toEqual(["menote", "笔记"]);
  });
});

describe("索引文本", () => {
  it("包含标题、标签（带 #）与正文", () => {
    const text = buildSearchText({ title: "会议记录", tags: ["工作", "dev"], body: "讨论了方案" });
    expect(text).toContain("会议记录");
    expect(text).toContain("#工作");
    expect(text).toContain("#dev");
    expect(text).toContain("讨论了方案");
  });

  it("没有标题或标签时不产生空行", () => {
    expect(buildSearchText({ title: null, tags: [], body: "正文" })).toBe("正文");
  });
});

describe("高亮片段", () => {
  it("以命中词为中心，两侧各留上下文并加省略号", () => {
    const long = `${"前".repeat(60)}命中${"后".repeat(60)}`;
    const snippet = makeSnippet(long, "命中");
    expect(snippet.match).toBe("命中");
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
  });

  it("命中在最前面时不加前省略号", () => {
    expect(makeSnippet("命中在开头", "命中").before).toBe("");
  });

  it("不命中时退回开头一段（不至于没有内容可显示）", () => {
    const snippet = makeSnippet("完全没有那个词", "找不到");
    expect(snippet.match).toBe("");
    expect(snippet.before).toBe("完全没有那个词");
  });
});

describe("检索", () => {
  const rows = [
    row("a", "会议记录\n#工作\n讨论了发布方案", 300),
    row("b", "购物清单\n#生活\n买牛奶和鸡蛋", 200),
    row("c", "发布方案草稿\n#工作\n正文里也提到方案", 100),
  ];

  it("中文子串命中（不依赖分词是否正确）", () => {
    expect(searchRows("方案", rows).map((hit) => hit.itemId).sort()).toEqual(["a", "c"]);
  });

  it("多个词是 AND 关系", () => {
    expect(searchRows("方案 牛奶", rows)).toEqual([]);
    expect(searchRows("方案 发布", rows).map((hit) => hit.itemId).sort()).toEqual(["a", "c"]);
  });

  it("标签也算命中（#工作）", () => {
    expect(searchRows("工作", rows).map((hit) => hit.itemId).sort()).toEqual(["a", "c"]);
  });

  it("标题命中排在同分之前（分数更高）", () => {
    const hits = searchRows("发布方案", rows);
    expect(hits[0]?.itemId).toBe("c"); // 标题里就有整串
  });

  it("空查询返回空结果（不返回全部）", () => {
    expect(searchRows("", rows)).toEqual([]);
    expect(searchRows("   ", rows)).toEqual([]);
  });

  it("大小写不敏感", () => {
    const english = [row("e", "Deploy Notes")];
    expect(searchRows("deploy", english)).toHaveLength(1);
    expect(searchRows("DEPLOY", english)).toHaveLength(1);
  });

  it("同分时按最近更新排序（结果稳定）", () => {
    const same = [row("old", "方案", 1), row("new", "方案", 9)];
    expect(searchRows("方案", same).map((hit) => hit.itemId)).toEqual(["new", "old"]);
  });

  it("每条命中都带片段", () => {
    const hits = searchRows("方案", rows);
    expect(hits.every((hit) => hit.snippet.match !== "")).toBe(true);
  });
});

describe("两条来源合并（本地索引在前，服务端补齐）", () => {
  it("按 key 去重，先出现的优先", () => {
    const local = [{ id: "a", from: "local" }, { id: "b", from: "local" }];
    const remote = [{ id: "b", from: "remote" }, { id: "c", from: "remote" }];

    expect(mergeBy((row) => row.id, local, remote)).toEqual([
      { id: "a", from: "local" },
      { id: "b", from: "local" },
      { id: "c", from: "remote" },
    ]);
  });

  it("只有服务端结果时照常返回；都为空时返回空数组", () => {
    const key = (row: { id: string }): string => row.id;
    expect(mergeBy(key, [], [{ id: "x" }])).toEqual([{ id: "x" }]);
    expect(mergeBy(key, [], [])).toEqual([]);
  });
});
