// sources.test.js - migrateInstances 字段迁移测试
import { describe, it, expect } from "vitest";
import { migrateInstances } from "../sources.js";

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
