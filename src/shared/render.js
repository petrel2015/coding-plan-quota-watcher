// 归一化逻辑（从 render.js 抽取，ES module）
// 依赖 format.js 的 formatNum / pad
import { formatNum, pad } from "./format.js";

// 将各数据源的原始 API 返回归一化为统一结构
// 返回: { planType, windows: [{label, usedPct, detail, resetMs, startMs}], extras: [{label, value}] }
export function normalizeData(type, data) {
  if (type === "volcengine-ark") {
    const result = data.Result;
    if (!result) return null;
    const windows = [];
    const defs = [
      { key: "AFPFiveHour", label: "5小时窗口" },
      { key: "AFPWeekly", label: "周窗口" },
      { key: "AFPMonthly", label: "月窗口" },
    ];
    for (const w of defs) {
      const d = result[w.key];
      if (d) {
        const used = d.Used || 0;
        const quota = d.Quota || 0;
        const remaining = Math.max(0, quota - used);
        // 火山方舟 API 无 StartTime，按窗口类型推算
        const durationMs = {
          "AFPFiveHour": 5 * 3600 * 1000,
          "AFPWeekly": 7 * 24 * 3600 * 1000,
          "AFPMonthly": 30 * 24 * 3600 * 1000,
        }[w.key];
        // ResetTime 可能是秒级（10位）或毫秒级（13位），统一转成毫秒
        let resetMsNorm = 0;
        if (d.ResetTime && d.ResetTime > 0) {
          resetMsNorm = d.ResetTime < 1e12 ? d.ResetTime * 1000 : d.ResetTime;
        }
        // ResetTime 为 0 时，按窗口类型从当前时间推算重置时间
        if (!resetMsNorm && durationMs) {
          if (w.key === "AFPMonthly") {
            // 月窗口：重置时间为下月1日 0点
            const now = new Date();
            resetMsNorm = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
          } else {
            resetMsNorm = Date.now() + durationMs;
          }
        }
        let startMsVal = null;
        if (d.StartTime && d.StartTime > 0) {
          startMsVal = d.StartTime < 1e12 ? d.StartTime * 1000 : d.StartTime;
        } else if (resetMsNorm && durationMs) {
          startMsVal = resetMsNorm - durationMs;
        }
        windows.push({
          label: w.label,
          usedPct: quota > 0 ? (used / quota) * 100 : 0,
          detail: `${formatNum(used)} / ${formatNum(quota)}（剩余 ${formatNum(remaining)}）`,
          resetMs: resetMsNorm,
          startMs: startMsVal,
        });
      }
    }
    return {
      planType: result.PlanType || null,
      windows,
      extras: [],
    };
  }

  if (type === "minimax") {
    const models = data.model_remains;
    if (!models) return null;
    const windows = [];
    for (const m of models) {
      if (m.model_name !== "general") continue;
      const intervalMs = m.end_time - m.start_time;
      const intervalHours = Math.round(intervalMs / 3600000);
      const shortLabel = intervalHours > 0 ? `${intervalHours}小时窗口` : "短窗口";
      const isActive = (s) => s !== 3;
      if (isActive(m.current_interval_status)) {
        windows.push({
          label: shortLabel,
          usedPct: parseFloat(m.current_interval_used_percent) || 0,
          detail: null,
          resetMs: m.end_time,
          startMs: m.start_time,
        });
      }
      if (isActive(m.current_weekly_status)) {
        windows.push({
          label: "周窗口",
          usedPct: parseFloat(m.current_weekly_used_percent) || 0,
          detail: null,
          resetMs: m.weekly_end_time,
          startMs: m.weekly_start_time || null,
        });
      }
    }
    return {
      planType: data._planName
        ? data._planName.replace(/^TokenPlan/i, "").replace(/^-/, "").replace(/月度会员/, "月度")
        : (data.plan_name || data.plan_type || data.subscription_plan || null),
      windows,
      extras: [],
    };
  }

  if (type === "chatgpt-codex") {
    const rateLimit = data.rate_limit;
    if (!rateLimit) return null;
    const windows = [];
    const primary = rateLimit.primary_window;
    if (primary) {
      const resetMs = (primary.reset_at || 0) * 1000;
      const limitSec = primary.limit_window_seconds || 0;
      windows.push({
        label: "周窗口",
        usedPct: primary.used_percent || 0,
        detail: null,
        resetMs,
        startMs: limitSec > 0 ? resetMs - limitSec * 1000 : null,
      });
    }
    if (rateLimit.secondary_window) {
      const sec = rateLimit.secondary_window;
      const resetMs = (sec.reset_at || 0) * 1000;
      const limitSec = sec.limit_window_seconds || 0;
      windows.push({
        label: "次级窗口",
        usedPct: sec.used_percent || 0,
        detail: null,
        resetMs,
        startMs: limitSec > 0 ? resetMs - limitSec * 1000 : null,
      });
    }
    const extras = [];
    if (data.credits) {
      const bal = data.credits.balance || "0";
      const balNum = parseFloat(bal);
      extras.push({ label: "Credits 余额", value: balNum > 0 ? `$${balNum.toFixed(2)}` : "$0" });
    }
    if (data.rate_limit_reset_credits) {
      extras.push({ label: "重置 Credits 次数", value: String(data.rate_limit_reset_credits.available_count || 0) });
    }

    // codex-reset.com 重置预测
    const fc = data._resetForecast;
    if (fc) {
      if (fc.last_reset_at) {
        const lastDate = new Date(fc.last_reset_at);
        extras.push({ label: "上次重置", value: `${lastDate.getMonth() + 1}月${lastDate.getDate()}日 ${pad(lastDate.getHours())}:${pad(lastDate.getMinutes())}` });
      }
      extras.push({ label: "官方重置信号", value: fc.official_signal ? "有" : "无" });
      if (fc.probabilities) {
        const p24 = fc.probabilities.rounded_24h || 0;
        const p48 = fc.probabilities.rounded_48h || 0;
        extras.push({ label: "24h/48h 重置概率", value: `${p24}% / ${p48}%` });
      }
    }
    return {
      planType: data.plan_type || null,
      windows,
      extras,
    };
  }

  if (type === "zhipu-glm") {
    const limits = data.data && data.data.limits;
    if (!limits) return null;
    const windows = [];
    for (const lim of limits) {
      // unit=3,number=5 -> 5小时窗口; unit=6,number=1 -> 周窗口
      let label = null;
      let durationMs = 0;
      if (lim.unit === 3 && lim.number === 5) {
        label = "5小时窗口";
        durationMs = 5 * 3600 * 1000;
      } else if (lim.unit === 6 && lim.number === 1) {
        label = "周窗口";
        durationMs = 7 * 24 * 3600 * 1000;
      } else {
        // 通用 fallback
        label = `${lim.number}${lim.unit === 3 ? "小时窗口" : "天窗口"}`;
        durationMs = lim.unit === 3 ? lim.number * 3600 * 1000 : lim.number * 24 * 3600 * 1000;
      }
      const used = lim.currentValue || 0;
      const quota = lim.usage || 0;
      const remaining = Math.max(0, quota - used);
      const pct = lim.percentage || 0;
      const resetMs = lim.nextResetTime || 0;
      const startMs = resetMs && durationMs ? resetMs - durationMs : null;
      windows.push({
        label,
        usedPct: pct,
        detail: `${formatNum(used)} / ${formatNum(quota)}（剩余 ${formatNum(remaining)}）`,
        resetMs,
        startMs,
      });
    }
    return {
      planType: (data.data && data.data.level) ? `Lv.${data.data.level}` : null,
      windows,
      extras: [],
    };
  }

  return null;
}

// 计算单个窗口的消耗速度预测文本（null 表示无预测）
// 返回 { text, level } level: "ok" | "warn" | null
export function computeForecast(win) {
  const pct = win.usedPct || 0;
  if (!win.startMs || !win.resetMs) return null;
  if (pct >= 100) return { text: "额度已用完，等待重置", level: "warn" };
  if (pct === 0) return { text: "暂无消耗，可用到重置", level: "ok" };
  const now = Date.now();
  const elapsedMs = now - win.startMs;
  const totalMs = win.resetMs - win.startMs;
  if (elapsedMs <= 60000 || totalMs <= 0) return null;
  // 按当前消耗速度，剩余额度能撑多久
  const remainingPct = 100 - pct;
  const consumeRatePerMs = pct / elapsedMs;
  const expectLastMs = remainingPct / consumeRatePerMs;
  const expectEndMs = now + expectLastMs;
  // 动态 import formatDuration 不现实，这里内联简单实现
  const fmtDur = (ms) => {
    if (ms <= 0) return "0分";
    const totalSec = Math.floor(ms / 1000);
    const dd = Math.floor(totalSec / 86400);
    const hh = Math.floor((totalSec % 86400) / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    if (dd > 0) return `${dd}天${hh}时${mm}分`;
    if (hh > 0) return `${hh}时${mm}分`;
    return `${mm}分`;
  };
  const d = new Date(expectEndMs);
  const expectStr = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (expectEndMs >= win.resetMs) {
    return { text: "按当前速度可用到重置", level: "ok" };
  }
  const shortageMs = win.resetMs - expectEndMs;
  return { text: `预计 ${expectStr} 用尽，比重置早 ${fmtDur(shortageMs)}`, level: "warn" };
}
