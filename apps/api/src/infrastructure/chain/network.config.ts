import type { Hex } from '@once/domain';

/**
 * 어느 체인에 붙는가.
 *
 * 두 모드가 있고 **조용히 섞이지 않는다.**
 *
 *   local-circuit  컴파일된 회로를 프로세스 안에서 실행한다. 지갑도 자금도
 *                  필요 없어서 심사위원이 클론하고 바로 돌릴 수 있다.
 *                  tx 해시와 블록 번호는 시뮬레이터가 붙인 번호다.
 *   preprod        실제 Midnight 체인을 인덱서로 읽는다. 쓰기는 사용자
 *                  지갑이 브라우저에서 한다. 서버는 서명하지 않는다.
 *
 * 전환은 환경변수 하나다. 기본값은 local-circuit 이다 — 심사 경로가
 * 아무 설정 없이 동작해야 하기 때문이다 (README §1).
 */
export interface NetworkConfig {
  readonly name: string;
  readonly indexerHttp: string;
  readonly indexerWs: string;
  readonly contractAddress: Hex;
  /** 액션 이력을 어디서부터 걸을지. 배포 블록. */
  readonly deployBlock: number;
  /** 원장 뷰 캐시 수명(ms). 인덱서를 매 요청마다 때리지 않기 위한 것. */
  readonly cacheMs: number;
  /** Node 용 WebSocket 생성자. 브라우저는 전역을 쓴다. */
  readonly webSocket?: new (url: string, protocol?: string) => unknown;
}

export const NETWORK_CONFIG = Symbol('NETWORK_CONFIG');

export const PREPROD_INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
export const PREPROD_INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';

export interface ChainModeEnv {
  readonly CHAIN_MODE?: string;
  readonly CONTRACT_ADDRESS?: string;
  readonly DEPLOY_BLOCK?: string;
  readonly INDEXER_HTTP?: string;
  readonly INDEXER_WS?: string;
}

export function isPreprodMode(env: ChainModeEnv = process.env): boolean {
  return (env.CHAIN_MODE ?? 'local-circuit') === 'preprod';
}

/**
 * preprod 설정을 읽는다. 없으면 **기본값으로 때우지 않고 중단한다.**
 *
 * 컨트랙트 주소를 짐작해 붙으면 빈 원장을 읽고 화면이 "대출 0건" 을
 * 보여준다. 그건 틀린 정보가 조용히 맞는 것처럼 보이는 경우다.
 */
export function loadPreprodConfig(env: ChainModeEnv = process.env): Omit<NetworkConfig, 'webSocket'> {
  const address = env.CONTRACT_ADDRESS;
  if (!address || !/^(0x)?[0-9a-f]{64}$/i.test(address)) {
    throw new Error(
      'CHAIN_MODE=preprod 이면 CONTRACT_ADDRESS 가 32바이트 16진수여야 한다. ' +
        'apps/deploy/deployment.json 의 contractAddress 를 쓴다.',
    );
  }
  const deployBlock = Number(env.DEPLOY_BLOCK ?? '');
  if (!Number.isInteger(deployBlock) || deployBlock <= 0) {
    throw new Error('CHAIN_MODE=preprod 이면 DEPLOY_BLOCK 이 배포 블록 높이여야 한다.');
  }
  return {
    name: 'preprod',
    indexerHttp: env.INDEXER_HTTP ?? PREPROD_INDEXER_HTTP,
    indexerWs: env.INDEXER_WS ?? PREPROD_INDEXER_WS,
    contractAddress: address.replace(/^0x/, '') as Hex,
    deployBlock,
    cacheMs: 3_000,
  };
}
