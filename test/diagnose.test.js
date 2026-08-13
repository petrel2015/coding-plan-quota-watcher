// diagnose.test.js - 错误诊断归类测试
import { describe, it, expect } from "vitest";
import { diagnoseError, isTerminalAuthDiag } from "../src/shared/diagnose.js";

describe("diagnoseError - 网络类", () => {
  it("Failed to fetch 归类为 network，并从 urls 提取 host", () => {
    const d = diagnoseError(new TypeError("Failed to fetch"), {
      type: "chatgpt-codex",
      authMode: "local",
      urls: ["https://chatgpt.com/backend-api/wham/usage"],
    });
    expect(d.category).toBe("network");
    expect(d.title).toBe("网络不通");
    expect(d.detail).toContain("chatgpt.com");
  });

  it("Failed to fetch 无 urls 时按 type 从模板反查 host", () => {
    const d = diagnoseError("Failed to fetch", { type: "zhipu-glm" });
    expect(d.category).toBe("network");
    // 智谱模板 url 是 bigmodel.cn，tokenEndpoint 无；至少含 bigmodel.cn
    expect(d.detail).toContain("bigmodel.cn");
  });

  it("Chrome 的 ERR_CONNECTION_REFUSED 也归网络", () => {
    const d = diagnoseError("net::ERR_CONNECTION_REFUSED", { type: "minimax" });
    expect(d.category).toBe("network");
  });
});

describe("diagnoseError - 超时", () => {
  it("请求超时归 timeout 并提取 host", () => {
    const d = diagnoseError("请求超时（20s）", {
      type: "chatgpt-codex",
      authMode: "local",
    });
    expect(d.category).toBe("timeout");
    expect(d.title).toBe("请求超时");
    expect(d.detail).toContain("chatgpt.com");
  });

  it("英文 timeout 也归 timeout", () => {
    const d = diagnoseError("operation timed out", { type: "minimax" });
    expect(d.category).toBe("timeout");
  });
});

describe("diagnoseError - 鉴权过期（401）", () => {
  it("HTTP 401：local 模式建议重新登录", () => {
    const d = diagnoseError("HTTP 401: unauthorized", {
      type: "volcengine-ark",
      authMode: "local",
    });
    expect(d.category).toBe("auth_expired");
    expect(d.title).toContain("401");
    expect(d.advice).toContain("重新登录");
  });

  it("HTTP 401：manual 模式建议重新粘贴 cookie", () => {
    const d = diagnoseError("HTTP 401: unauthorized", {
      type: "volcengine-ark",
      authMode: "manual",
    });
    expect(d.category).toBe("auth_expired");
    expect(d.advice).toContain("cURL");
  });

  it("Token 接口 HTTP 401（ChatGPT session 阶段）归 auth_expired", () => {
    const d = diagnoseError("Token 接口 HTTP 401", {
      type: "chatgpt-codex",
      authMode: "local",
    });
    expect(d.category).toBe("auth_expired");
    expect(d.detail).toContain("401");
  });

  it("ChatGPT accessToken 缺失归 auth_expired", () => {
    const d = diagnoseError(
      "无法从 https://chatgpt.com/api/auth/session 获取 accessToken，可能未登录",
      { type: "chatgpt-codex", authMode: "local" },
    );
    expect(d.category).toBe("auth_expired");
    expect(d.title).toContain("ChatGPT");
  });
});

describe("diagnoseError - 凭证缺失", () => {
  it("csrfToken not found（volcengine local）归 auth_missing", () => {
    const d = diagnoseError("csrfToken not found. Cookies: a,b", {
      type: "volcengine-ark",
      authMode: "local",
    });
    expect(d.category).toBe("auth_missing");
    expect(d.advice).toContain("登录");
  });

  it("curl 中未找到 csrfToken（volcengine manual）归 auth_missing 且建议 cURL", () => {
    const d = diagnoseError("curl 中未找到 csrfToken 或 X-Csrf-Token", {
      type: "volcengine-ark",
      authMode: "manual",
    });
    expect(d.category).toBe("auth_missing");
    expect(d.advice).toContain("cURL");
  });
});

describe("diagnoseError - HTTP 其它状态", () => {
  it("403 归 forbidden", () => {
    const d = diagnoseError("HTTP 403: forbidden", { type: "minimax" });
    expect(d.category).toBe("forbidden");
    expect(d.title).toContain("403");
  });

  it("404 归 bad_response", () => {
    const d = diagnoseError("HTTP 404: not found", { type: "minimax" });
    expect(d.category).toBe("bad_response");
    expect(d.title).toContain("404");
  });

  it("429 归 rate_limited", () => {
    const d = diagnoseError("HTTP 429: too many requests", { type: "zhipu-glm" });
    expect(d.category).toBe("rate_limited");
  });

  it("500 归 server_error", () => {
    const d = diagnoseError("HTTP 500: internal error", { type: "volcengine-ark" });
    expect(d.category).toBe("server_error");
    expect(d.title).toContain("500");
  });

  it("其它 4xx 归 bad_response", () => {
    const d = diagnoseError("HTTP 422: validation", { type: "minimax" });
    expect(d.category).toBe("bad_response");
    expect(d.title).toContain("422");
  });

  it("HTTP body 超长被截断", () => {
    const longBody = "x".repeat(500);
    const d = diagnoseError(`HTTP 500: ${longBody}`, { type: "minimax" });
    expect(d.detail.length).toBeLessThan(200);
    expect(d.detail).toContain("…");
  });
});

describe("diagnoseError - 响应异常", () => {
  it("JSON 解析失败（unexpected token）归 bad_response 并提示登录态", () => {
    const d = diagnoseError("Unexpected token < in JSON at position 0", {
      type: "zhipu-glm",
      authMode: "local",
    });
    expect(d.category).toBe("bad_response");
    expect(d.detail).toContain("非 JSON");
  });
});

describe("isTerminalAuthDiag - 终态鉴权错误判定", () => {
  it("auth_expired（登录失效）视为终态", () => {
    expect(isTerminalAuthDiag({ category: "auth_expired" })).toBe(true);
  });

  it("auth_missing（凭证缺失）视为终态", () => {
    expect(isTerminalAuthDiag({ category: "auth_missing" })).toBe(true);
  });

  it("瞬态错误（network/timeout/429/500 等）不视为终态", () => {
    for (const c of ["network", "timeout", "forbidden", "rate_limited", "server_error", "bad_response", "unknown"]) {
      expect(isTerminalAuthDiag({ category: c }), c).toBe(false);
    }
  });

  it("null/undefined/空对象安全返回 false", () => {
    expect(isTerminalAuthDiag(null)).toBe(false);
    expect(isTerminalAuthDiag(undefined)).toBe(false);
    expect(isTerminalAuthDiag({})).toBe(false);
  });
});

describe("diagnoseError - 兜底", () => {
  it("未知数据源类型归 unknown + 配置异常", () => {
    const d = diagnoseError("未知数据源类型: foo", { type: "foo" });
    expect(d.category).toBe("unknown");
    expect(d.title).toBe("配置异常");
  });

  it("完全未知的 message 走兜底", () => {
    const d = diagnoseError("something weird happened", { type: "minimax" });
    expect(d.category).toBe("unknown");
    expect(d.title).toBe("获取失败");
    expect(d.detail).toContain("something weird");
  });

  it("null/undefined 安全", () => {
    const d1 = diagnoseError(null, { type: "minimax" });
    const d2 = diagnoseError(undefined, { type: "minimax" });
    expect(d1.category).toBe("unknown");
    expect(d2.category).toBe("unknown");
  });
});
