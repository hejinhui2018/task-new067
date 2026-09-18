import { describe, expect, it } from 'vitest';
import { fmtClock, fmtDur, fmtSignedDur, parseClock, parseDuration } from './time';

describe('时间格式化', () => {
  it('fmtClock', () => {
    expect(fmtClock(36900)).toBe('10:15:00');
    expect(fmtClock(0)).toBe('00:00:00');
  });

  it('fmtDur', () => {
    expect(fmtDur(600)).toBe('10:00');
    expect(fmtDur(65)).toBe('1:05');
    expect(fmtDur(3661)).toBe('1:01:01');
    expect(fmtDur(-90)).toBe('-1:30');
  });

  it('fmtSignedDur', () => {
    expect(fmtSignedDur(90)).toBe('+1:30');
    expect(fmtSignedDur(-90)).toBe('-1:30');
    expect(fmtSignedDur(0)).toBe('±0:00');
  });
});

describe('解析', () => {
  it('parseDuration 支持 m:ss / h:mm:ss / 纯数字分钟', () => {
    expect(parseDuration('6:00')).toBe(360);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('10')).toBe(600);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('parseClock', () => {
    expect(parseClock('10:15')).toBe(36900);
    expect(parseClock('10:15:30')).toBe(36930);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('10:75')).toBeNull();
  });
});
