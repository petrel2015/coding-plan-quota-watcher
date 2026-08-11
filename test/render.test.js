// render.test.js - normalizeData 各数据源归一化测试
import { describe, it, expect } from "vitest";
import { normalizeData } from "../src/shared/render.js";

describe("normalizeData - volcengine-ark", () => {
  it("归一化 5h/周/月三个窗口", () => {
    const now = Math.floor(Date.now() / 1000);
    const data = {
      Result: {
        PlanType: "AgentPlan-Pro",
        AFPFiveHour: { Used: 100, Quota: 1000, ResetTime: now + 3600 },
        AFPWeekly: { Used: 3000, Quota: 10000, ResetTime: now + 86400 },
        AFPMonthly: { Used: 50000, Quota: 100000, ResetTime: 0 },
      },
    };
    const r = normalizeData("volcengine-ark", data);
    expect(r.planType).toBe("AgentPlan-Pro");
    expect(r.windows).toHaveLength(3);
    // 5h 窗口：100/1000 = 10%
    expect(r.windows[0].label).toBe("5小时窗口");
    expect(r.windows[0].usedPct).toBeCloseTo(10, 1);
    // 月窗口 ResetTime=0 时推算为下月1日
    const now2 = new Date();
    const nextMonth = new Date(now2.getFullYear(), now2.getMonth() + 1, 1);
    expect(r.windows[2].resetMs).toBe(nextMonth.getTime());
  });

  it("处理秒级和毫秒级 ResetTime", () => {
    const sec = Math.floor(Date.now() / 1000) + 3600;
    const data1 = {
      Result: {
        AFPFiveHour: { Used: 50, Quota: 100, ResetTime: sec },
      },
    };
    const r1 = normalizeData("volcengine-ark", data1);
    expect(r1.windows[0].resetMs).toBe(sec * 1000);

    const ms = Date.now() + 3600000;
    const data2 = {
      Result: {
        AFPFiveHour: { Used: 50, Quota: 100, ResetTime: ms },
      },
    };
    const r2 = normalizeData("volcengine-ark", data2);
    expect(r2.windows[0].resetMs).toBe(ms);
  });

  it("无 Result 返回 null", () => {
    expect(normalizeData("volcengine-ark", {})).toBeNull();
    expect(normalizeData("volcengine-ark", { Result: null })).toBeNull();
  });
});

describe("normalizeData - minimax", () => {
  it("只取 general 模型，活跃窗口", () => {
    const data = {
      model_remains: [
        {
          model_name: "general",
          current_interval_status: 1, // 活跃
          current_interval_used_percent: "45.5",
          start_time: 1000,
          end_time: 1000 + 5 * 3600 * 1000,
          current_weekly_status: 3, // 不活跃
        },
      ],
    };
    const r = normalizeData("minimax", data);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].label).toBe("5小时窗口");
    expect(r.windows[0].usedPct).toBeCloseTo(45.5, 1);
  });

  it("忽略非 general 模型", () => {
    const data = {
      model_remains: [
        { model_name: "abab", current_interval_status: 1, current_weekly_status: 3, current_interval_used_percent: "10" },
        { model_name: "general", current_interval_status: 1, current_weekly_status: 3, current_interval_used_percent: "20" },
      ],
    };
    const r = normalizeData("minimax", data);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].usedPct).toBeCloseTo(20, 1);
  });

  it("无 model_remains 返回 null", () => {
    expect(normalizeData("minimax", {})).toBeNull();
  });
});

describe("normalizeData - chatgpt-codex", () => {
  it("归一化主窗口 + 次级窗口 + credits", () => {
    const resetAt = Math.floor(Date.now() / 1000) + 86400;
    const data = {
      rate_limit: {
        primary_window: { used_percent: 60, reset_at: resetAt, limit_window_seconds: 604800 },
        secondary_window: { used_percent: 30, reset_at: resetAt, limit_window_seconds: 86400 },
      },
      credits: { balance: "12.50" },
      rate_limit_reset_credits: { available_count: 2 },
    };
    const r = normalizeData("chatgpt-codex", data);
    expect(r.windows).toHaveLength(2);
    expect(r.windows[0].label).toBe("周窗口");
    expect(r.windows[0].usedPct).toBe(60);
    expect(r.extras).toContainEqual({ label: "Credits 余额", value: "$12.50" });
    expect(r.extras).toContainEqual({ label: "重置 Credits 次数", value: "2" });
  });

  it("无 rate_limit 返回 null", () => {
    expect(normalizeData("chatgpt-codex", { credits: {} })).toBeNull();
  });
});

describe("normalizeData - zhipu-glm", () => {
  it("unit=3,number=5 -> 5小时窗口；unit=6,number=1 -> 周窗口", () => {
    const nextReset = Date.now() + 3600000;
    const data = {
      data: {
        level: 3,
        limits: [
          { unit: 3, number: 5, currentValue: 200, usage: 1000, percentage: 20, nextResetTime: nextReset },
          { unit: 6, number: 1, currentValue: 5000, usage: 50000, percentage: 10, nextResetTime: nextReset },
        ],
      },
    };
    const r = normalizeData("zhipu-glm", data);
    expect(r.planType).toBe("Lv.3");
    expect(r.windows).toHaveLength(2);
    expect(r.windows[0].label).toBe("5小时窗口");
    expect(r.windows[0].usedPct).toBe(20);
    expect(r.windows[1].label).toBe("周窗口");
  });

  it("无 limits 返回 null", () => {
    expect(normalizeData("zhipu-glm", { data: {} })).toBeNull();
    expect(normalizeData("zhipu-glm", {})).toBeNull();
  });
});

describe("normalizeData - 未知类型", () => {
  it("返回 null", () => {
    expect(normalizeData("unknown", { foo: "bar" })).toBeNull();
  });
});
