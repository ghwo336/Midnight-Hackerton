'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from '@once/contract';
import { buildProviders, ONCE_PRIVATE_STATE_ID } from './providers';

/**
 * 브라우저에서 컨트랙트를 배포한다.
 *
 * 이것이 S6 전환의 목적이다. 지갑이 수수료를 내고 트랜잭션을 제출하므로,
 * 백엔드 경로를 몇 시간째 막고 있는 dust 지갑 동기화가 여기에는 없다.
 *
 * 배포가 성공하면 화면의 "모의" 표기가 사라지고 진짜 tx 해시가 들어간다.
 */

export interface DeployResult {
  readonly contractAddress: string;
  readonly txId: string;
  readonly blockHeight: number;
  readonly elapsedMs: number;
}

export interface DeployParams {
  readonly issuerId: string;
  readonly issuerPk: string;
  readonly ltvBps: bigint;
  /** 발급 기관 비밀키. 브라우저 밖으로 나가지 않는다. */
  readonly issuerSecret: string;
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function deployOnce(
  api: ConnectedAPI,
  params: DeployParams,
): Promise<DeployResult> {
  const providers = await buildProviders(api);

  // witness는 packages/chain의 것을 쓰지 않는다. 그 패키지는 Node 전용이고,
  // 브라우저에서는 비공개 상태를 IndexedDB에서 읽는 구현이 따로 필요하다.
  const base = CompiledContract.make('once', Contract as never);
  const withWitnesses = CompiledContract.withVacantWitnesses(base as never);
  const compiled = CompiledContract.withCompiledFileAssets(
    withWitnesses as never,
    new URL('/zk', window.location.origin).toString() as never,
  );

  const started = Date.now();
  const deployed = await deployContract(providers as never, {
    compiledContract: compiled as never,
    privateStateId: ONCE_PRIVATE_STATE_ID,
    initialPrivateState: { issuerSecret: hexToBytes(params.issuerSecret), activeInvoice: null },
    args: [hexToBytes(params.issuerId), hexToBytes(params.issuerPk), params.ltvBps],
  } as never);

  const pub = (deployed as unknown as {
    deployTxData: { public: { contractAddress: string; txId: string; blockHeight: number } };
  }).deployTxData.public;

  return {
    contractAddress: pub.contractAddress,
    txId: pub.txId,
    blockHeight: pub.blockHeight,
    elapsedMs: Date.now() - started,
  };
}
