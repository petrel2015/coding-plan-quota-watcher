// i18n.test.js - 轻量 i18n 引擎单测
import { describe, it, expect, afterEach } from "vitest";
import { t, getLocale, setLocale } from "../src/shared/i18n.js";

describe("i18n", () => {
  afterEach(() => setLocale("zh"));

  it("初始 locale 是支持的语言之一", () => {
    expect(["zh", "en"]).toContain(getLocale());
  });

  it("t() 中文查表 + 插值", () => {
    setLocale("zh");
    expect(t("card.refresh")).toBe("刷新");
    expect(t("card.updated", { time: "3分钟前" })).toBe("更新于 3分钟前");
  });

  it("t() 英文查表 + 插值", () => {
    setLocale("en");
    expect(t("card.refresh")).toBe("Refresh");
    expect(t("card.updated", { time: "3m ago" })).toBe("Updated 3m ago");
  });

  it("setLocale / getLocale 切换", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    setLocale("zh");
    expect(getLocale()).toBe("zh");
  });

  it("缺失 key 回退到 key 本身", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });
});
