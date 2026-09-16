import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from '@once/contract';
import { witnesses } from '@once/chain';
import { zkConfigPath } from './config.js';

/**
 * 배포용 컨트랙트.
 *
 * witness 구현은 packages/chain의 것을 그대로 쓴다. 로컬 시뮬레이터와
 * 테스트넷이 **같은 witness 코드**를 돌린다는 뜻이고, 로컬에서 통과한
 * 공격 테스트가 여기서도 같은 의미를 갖는 근거가 된다.
 */
export const onceCompiledContract = CompiledContract.make('once', Contract).pipe(
  (self) => CompiledContract.withWitnesses(self as never, witnesses as never),
  (self) => CompiledContract.withCompiledFileAssets(self as never, zkConfigPath as never),
);
