import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

/**
 * Preprod 테스트넷 설정.
 *
 * 엔드포인트는 공식 문서와 Midnight Expert 플러그인이 같은 값을 준다.
 * proof server는 로컬 도커로 띄운다 (docs/DEPLOYMENT.md 참조).
 */
export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export interface NetworkConfig {
  readonly name: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export const PREPROD: NetworkConfig = {
  name: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: process.env['PROOF_SERVER_URL'] ?? 'http://127.0.0.1:6300',
};

export function useNetwork(config: NetworkConfig = PREPROD): NetworkConfig {
  setNetworkId(config.name as Parameters<typeof setNetworkId>[0]);
  return config;
}

/** 컴파일 산출물 위치. 증명키·검증키가 여기 있다. */
export const zkConfigPath = path.resolve(
  currentDir, '..', '..', '..', 'contracts', 'managed', 'once',
);

export const PRIVATE_STATE_STORE = 'once-private-state';
export const ONCE_PRIVATE_STATE_ID = 'oncePrivateState';

/** 지갑 시드. 커밋 금지 (SPEC §14). */
export function requireSeed(): string {
  const seed = process.env['DEPLOY_WALLET_SEED'];
  if (!seed || !/^[0-9a-f]{64}$/.test(seed)) {
    throw new Error(
      'DEPLOY_WALLET_SEED must be a 32-byte hex seed. Generate one with: pnpm --filter @once/deploy address',
    );
  }
  return seed;
}
