import { useEffect, useState } from 'react';

export interface Playhead {
  /** 播放头位置：距开播的秒数 */
  offset: number;
  playing: boolean;
  /** 倍速：1 = 实时，60 = 1 秒播 1 分钟 */
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  seek: (offset: number) => void;
}

const TICK_MS = 250;

/** 播放头：按倍速推进，走完全档自动停止；总时长变化时收敛位置 */
export function usePlayhead(totalSeconds: number): Playhead {
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setOffset((o) => Math.min(o + (TICK_MS / 1000) * speed, totalSeconds));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, speed, totalSeconds]);

  useEffect(() => {
    if (playing && offset >= totalSeconds) setPlaying(false);
  }, [offset, playing, totalSeconds]);

  useEffect(() => {
    setOffset((o) => Math.min(o, Math.max(0, totalSeconds)));
  }, [totalSeconds]);

  return {
    offset,
    playing,
    speed,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => !p),
    reset: () => {
      setPlaying(false);
      setOffset(0);
    },
    setSpeed,
    seek: (o) => setOffset(Math.max(0, Math.min(o, totalSeconds))),
  };
}
