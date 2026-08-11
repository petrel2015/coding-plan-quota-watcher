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
  it("空列表返回基础名", () => {
    expect(generateInstanceName([])).toBe("coding plan");
  });

  it("无重复时返回基础名", () => {
    const instances = [{ id: "1", name: "火山方舟 #1" }];
    expect(generateInstanceName(instances)).toBe("coding plan");
  });

  it("已有一个同名时返回 #2", () => {
    const instances = [{ id: "1", name: "coding plan" }];
    expect(generateInstanceName(instances)).toBe("coding plan #2");
  });

  it("已有多个同名时递增编号", () => {
    const instances = [
      { id: "1", name: "coding plan" },
      { id: "2", name: "coding plan #2" },
      { id: "3", name: "coding plan #3" },
    ];
    expect(generateInstanceName(instances)).toBe("coding plan #4");
  });

  it("忽略不相关名字", () => {
    const instances = [
      { id: "1", name: "MiniMax #1" },
      { id: "2", name: "智谱 GLM" },
    ];
    expect(generateInstanceName(instances)).toBe("coding plan");
  });

  it("null/undefined 安全处理", () => {
    expect(generateInstanceName(null)).toBe("coding plan");
    expect(generateInstanceName(undefined)).toBe("coding plan");
  });
});
