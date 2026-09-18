const pad = (n: number) => String(n).padStart(2, '0');

/** 秒 → 「HH:MM:SS」挂钟时间 */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 秒 → 「m:ss」/「h:mm:ss」时长（负值带负号） */
export function fmtDur(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(sec)}` : `${sign}${m}:${pad(sec)}`;
}

/** 带符号时长：+1:30 / -0:45 / ±0:00 */
export function fmtSignedDur(seconds: number): string {
  if (Math.round(seconds) === 0) return '±0:00';
  return seconds > 0 ? `+${fmtDur(seconds)}` : fmtDur(seconds);
}

/**
 * 解析时长输入：
 * - 「6:00」「1:02:03」→ 分:秒 / 时:分:秒
 * - 纯数字（可小数）→ 按分钟计，如「10」= 10 分钟、「1.5」= 90 秒
 * 非法输入返回 null。
 */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  if (parts.length === 2) {
    if (nums[1] > 59) return null;
    return nums[0] * 60 + nums[1];
  }
  if (nums[1] > 59 || nums[2] > 59) return null;
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

/** 解析挂钟时间：「10:15」或「10:15:30」→ 当日秒数；非法返回 null */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}
