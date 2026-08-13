// 归一化逻辑（从 render.js 抽取，ES module）
// 依赖 format.js 的 formatNum / formatDateLabel / formatDuration
import { formatNum, formatDateLabel, formatDuration } from "./format.js";
import { t } from "./i18n.js";

// 将各数据源的原始 API 返回归一化为统一结构
// 返回: { planType, windows: [{label, usedPct, detail, resetMs, startMs}], extras: [{label, value}] }
export function normalizeData(type, data) {
  if (type === "volcengine-ark") {
    const result = data.Result;
    if (!result) return null;
    const windows = [];
    const defs = [
      { key: "AFPFiveHour", label: t("render.win5h") },
      { key: "AFPWeekly", label: t("render.winWeek") },
      { key: "AFPMonthly", label: t("render.winMonth") },
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
          detail: t("render.detailRemaining", {
            used: formatNum(used),
            quota: formatNum(quota),
            remaining: formatNum(remaining),
          }),
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
      const shortLabel = intervalHours > 0 ? t("render.winHourGeneric", { n: intervalHours }) : t("render.winShort");
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
          label: t("render.winWeek"),
          usedPct: parseFloat(m.current_weekly_used_percent) || 0,
          detail: null,
          resetMs: m.weekly_end_time,
          startMs: m.weekly_start_time || null,
        });
      }
    }
    return {
      planType: data._planName
        ? data._planName.replace(/^TokenPlan/i, "").replace(/^-/, "").replace(t("render.minimaxMonthlyFrom"), t("render.minimaxMonthlyTo"))
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
        label: t("render.winWeek"),
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
        label: t("render.winSecondary"),
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
      extras.push({ label: t("render.exCredits"), value: balNum > 0 ? `$${balNum.toFixed(2)}` : "$0" });
    }
    if (data.rate_limit_reset_credits) {
      extras.push({ label: t("render.exResetCount"), value: String(data.rate_limit_reset_credits.available_count || 0) });
    }

    // codex-reset.com 重置预测
    const fc = data._resetForecast;
    if (fc) {
      if (fc.last_reset_at) {
        const lastDate = new Date(fc.last_reset_at);
        extras.push({ label: t("render.exLastReset"), value: formatDateLabel(lastDate) });
      }
      extras.push({ label: t("render.exOfficialSignal"), value: fc.official_signal ? t("render.exSignalYes") : t("render.exSignalNo") });
      if (fc.probabilities) {
        const p24 = fc.probabilities.rounded_24h || 0;
        const p48 = fc.probabilities.rounded_48h || 0;
        extras.push({ label: t("render.exResetProb"), value: `${p24}% / ${p48}%` });
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
        label = t("render.win5h");
        durationMs = 5 * 3600 * 1000;
      } else if (lim.unit === 6 && lim.number === 1) {
        label = t("render.winWeek");
        durationMs = 7 * 24 * 3600 * 1000;
      } else {
        // 通用 fallback
        label = lim.unit === 3 ? t("render.winHourGeneric", { n: lim.number }) : t("render.winDayGeneric", { n: lim.number });
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
        detail: t("render.detailRemaining", {
          used: formatNum(used),
          quota: formatNum(quota),
          remaining: formatNum(remaining),
        }),
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
  if (pct >= 100) return { text: t("render.fcDone"), level: "warn" };
  if (pct === 0) return { text: t("render.fcIdle"), level: "ok" };
  const now = Date.now();
  const elapsedMs = now - win.startMs;
  const totalMs = win.resetMs - win.startMs;
  if (elapsedMs <= 60000 || totalMs <= 0) return null;
  // 按当前消耗速度，剩余额度能撑多久
  const remainingPct = 100 - pct;
  const consumeRatePerMs = pct / elapsedMs;
  const expectLastMs = remainingPct / consumeRatePerMs;
  const expectEndMs = now + expectLastMs;
  const expectStr = formatDateLabel(new Date(expectEndMs));
  if (expectEndMs >= win.resetMs) {
    return { text: t("render.fcOk"), level: "ok" };
  }
  const shortageMs = win.resetMs - expectEndMs;
  return { text: t("render.fcShort", { date: expectStr, dur: formatDuration(shortageMs) }), level: "warn" };
}
