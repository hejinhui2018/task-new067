import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { RundownState } from '../types';
import type { ShowSchedule } from '../engine/showSchedule';
import type { RundownAction } from './reducer';

export interface RundownContextValue {
  present: RundownState;
  /** 双场地联排总调度（各场地时间线 + 跨场地资源碰撞） */
  show: ShowSchedule;
  dispatch: Dispatch<RundownAction>;
  canUndo: boolean;
  canRedo: boolean;
}

const RundownContext = createContext<RundownContextValue | null>(null);

export const RundownProvider = RundownContext.Provider;

export function useRundown(): RundownContextValue {
  const ctx = useContext(RundownContext);
  if (!ctx) throw new Error('useRundown 必须在 RundownProvider 内使用');
  return ctx;
}
