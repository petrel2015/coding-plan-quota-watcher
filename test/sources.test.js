// sources.test.js - migrateInstances / generateInstanceName 测试
import { describe, it, expect } from "vitest";
import { migrateInstances, generateInstanceName } from "../src/shared/sources.js";

describe("migrateInstances", () => {
  it("把 manualCookie 迁移到 manualCurl", () => {
    const input = [{ id: "1", manualCookie: "curl abc", enabled: true }];
    const { instances, changed } = migrateInstances(input);
    expect(changed).toBe(true);
    expect(instances[0].manualCurl).toBe("curl abc");
    expect(instances[0].manualCookie).toBeUndefined();
  });

  it("manualCurl 已存在时不覆盖", () => {
    const input = [{ id: "1", manualCookie: "old", manualCurl: "new", enabled: true }];
    const { instances, changed } = migrateInstances(input);
    expect(changed).toBe(false);
    expect(instances[0].manualCurl).toBe("new");
    // 旧字段保留（不在迁移条件内不清除）
    expect(instances[0].manualCookie).toBe("old");
  });

  it("无旧字段时 changed=false", () => {
    const input = [{ id: "1", manualCurl: "x", enabled: true }];
    const { instances, changed } = migrateInstances(input);
    expect(changed).toBe(false);
  });

  it("不修改入参（返回新数组新对象）", () => {
    const input = [{ id: "1", manualCookie: "curl", enabled: true }];
    const { instances } = migrateInstances(input);
    expect(instances).not.toBe(input);
    expect(instances[0]).not.toBe(input[0]);
    expect(input[0].manualCookie).toBe("curl"); // 原对象不变
  });

  it("空输入返回空数组", () => {
    expect(migrateInstances(null)).toEqual({ instances: [], changed: false });
    expect(migrateInstances(undefined)).toEqual({ instances: [], changed: false });
    expect(migrateInstances([])).toEqual({ instances: [], changed: false });
  });

  it("混合数组只迁移需要迁移的", () => {
    const input = [
      { id: "1", manualCurl: "ok" },
      { id: "2", manualCookie: "migrate-me" },
      { id: "3" },
    ];
    const { instances, changed } = migrateInstances(input);
    expect(changed).toBe(true);
    expect(instances[0].manualCurl).toBe("ok");
    expect(instances[1].manualCurl).toBe("migrate-me");
    expect(instances[1].manualCookie).toBeUndefined();
    expect(instances[2].manualCurl).toBeUndefined();
  });
});

describe("generateInstanceName", () => {
  it("空列表返回该类型的模板名", () => {
    expect(generateInstanceName("minimax", [])).toBe("MiniMax Token Plan");
  });

  it("无同名时返回模板名", () => {
    const instances = [{ id: "1", name: "火山方舟 Agent Plan" }];
    expect(generateInstanceName("minimax", instances)).toBe("MiniMax Token Plan");
  });

  it("已有一个同名（模板名）时返回 #2", () => {
    const instances = [{ id: "1", name: "MiniMax Token Plan" }];
    expect(generateInstanceName("minimax", instances)).toBe("MiniMax Token Plan #2");
  });

  it("已有多个同名时递增编号", () => {
    const instances = [
      { id: "1", name: "MiniMax Token Plan" },
      { id: "2", name: "MiniMax Token Plan #2" },
      { id: "3", name: "MiniMax Token Plan #3" },
    ];
    expect(generateInstanceName("minimax", instances)).toBe("MiniMax Token Plan #4");
  });

  it("不同类型的同名实例不计入该类型的重复", () => {
    const instances = [
      { id: "1", name: "MiniMax Token Plan", type: "minimax" },
      { id: "2", name: "智谱 GLM 用量", type: "zhipu-glm" },
    ];
    // 生成 zhipu-glm：已有 1 个同名 -> #2
    expect(generateInstanceName("zhipu-glm", instances)).toBe("智谱 GLM 用量 #2");
    // 生成 minimax：已有 1 个同名 -> #2
    expect(generateInstanceName("minimax", instances)).toBe("MiniMax Token Plan #2");
  });

  it("excludeId 排除自身（类型变更重命名场景）", () => {
    // 当前实例已是 "MiniMax Token Plan"，重算时不应把自己算进重复
    const instances = [{ id: "me", name: "MiniMax Token Plan", type: "minimax" }];
    expect(generateInstanceName("minimax", instances, "me")).toBe("MiniMax Token Plan");
  });

  it("excludeId 时其它同名仍计数", () => {
    const instances = [
      { id: "me", name: "MiniMax Token Plan", type: "minimax" },
      { id: "other", name: "MiniMax Token Plan", type: "minimax" },
    ];
    expect(generateInstanceName("minimax", instances, "me")).toBe("MiniMax Token Plan #2");
  });

  it("未知类型回退到 coding plan", () => {
    expect(generateInstanceName("unknown-type", [])).toBe("coding plan");
  });

  it("null/undefined 安全处理", () => {
    expect(generateInstanceName("minimax", null)).toBe("MiniMax Token Plan");
    expect(generateInstanceName("minimax", undefined)).toBe("MiniMax Token Plan");
  });
});
