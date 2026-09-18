import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { ledger, type Ledger } from '@once/contract';

export type { Ledger };
import type { Hex } from '@once/domain';
import type { ContractAction } from './types.js';

/**
 * 인덱서가 준 직렬화 상태를 원장 뷰로 되돌린다.
 *
 * 컴파일러가 만든 `ledger()` 를 그대로 쓴다. 인덱서 JSON 을 손으로 파싱해
 * 필드를 꺼내지 않는다. 그러면 회로가 바뀔 때 화면만 조용히 낡는다.
 */
export function decodeLedger(state: Uint8Array): Ledger {
  // ContractState.data 는 이미 ChargedState 다. ledger() 가 받는 타입과 같다.
  return ledger(ContractState.deserialize(state).data as Parameters<typeof ledger>[0]);
}

export function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** MerkleTreeDigest 는 필드 원소 하나다. 화면에는 32바이트 16진수로 보인다. */
export function digestToHex(digest: { field: bigint }): Hex {
  return `0x${digest.field.toString(16).padStart(64, '0')}` as Hex;
}

/**
 * 대출이 **어느 트랜잭션에서 생겼는지** 를 액션 이력에서 복원한다.
 *
 * 온체인 상태에는 그 정보가 없다. 원장은 nullifier → LoanRecord 만 들고
 * 있고 tx 해시를 담지 않는다. 그래서 액션을 순서대로 디코드하면서 loans 의
 * 키 집합이 늘어나는 순간을 찾는다. 그 액션의 tx 가 그 대출을 만든 것이다.
 *
 * 상환도 같은 방식으로 잡는다. repaid 가 false → true 로 바뀐 액션이 상환이다.
 */
export interface LoanOrigin {
  readonly nullifier: Hex;
  readonly txHash: Hex;
  readonly block: number;
  readonly settledAt: string;
  repaidTxHash: Hex | null;
  repaidBlock: number | null;
}

export function traceLoans(actions: readonly ContractAction[]): Map<Hex, LoanOrigin> {
  const origins = new Map<Hex, LoanOrigin>();
  const repaidSeen = new Set<Hex>();

  for (const action of actions) {
    let view: Ledger;
    try {
      view = decodeLedger(action.state);
    } catch {
      // 디코드할 수 없는 액션은 건너뛴다. 이력 복원은 최선 노력이고,
      // 실패하더라도 최신 상태 읽기는 영향받지 않는다.
      continue;
    }

    for (const [key, record] of view.loans) {
      const nullifier = bytesToHex(key);
      if (!origins.has(nullifier)) {
        origins.set(nullifier, {
          nullifier,
          txHash: action.txHash,
          block: action.block,
          settledAt: new Date(action.timestamp).toISOString(),
          repaidTxHash: null,
          repaidBlock: null,
        });
      }
      if (record.repaid && !repaidSeen.has(nullifier)) {
        repaidSeen.add(nullifier);
        const origin = origins.get(nullifier);
        if (origin) {
          origin.repaidTxHash = action.txHash;
          origin.repaidBlock = action.block;
        }
      }
    }
  }
  return origins;
}
