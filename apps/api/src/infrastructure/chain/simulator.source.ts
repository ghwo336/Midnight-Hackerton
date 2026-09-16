import type { OnceContractSimulator } from '@once/chain';

/** 게이트웨이가 시뮬레이터를 얻는 통로. 교체 가능하게 인터페이스로 둔다. */
export interface SimulatorSource {
  readonly current: OnceContractSimulator;
}

export const SIMULATOR_SOURCE = Symbol('SIMULATOR_SOURCE');

/** 테스트에서 시뮬레이터 하나를 그대로 쓰는 경우. */
export function fixedSource(simulator: OnceContractSimulator): SimulatorSource {
  return { current: simulator };
}
