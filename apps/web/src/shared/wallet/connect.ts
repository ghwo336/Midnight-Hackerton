'use client';

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { adoptNetworkId } from './network';

/**
 * Midnight 지갑 연결.
 *
 * 스파이크 S6-a에서 확인한 사실 세 가지가 이 파일의 형태를 정한다.
 *
 * 1. `window.midnight.mnLace`를 쓰면 안 된다. 실제 환경에서 지갑은
 *    UUID 키로 주입됐고(`4bc6098d-...`) mnLace 별칭이 없었다.
 *    반드시 열거해서 찾는다.
 *
 * 2. 지갑이 설정된 네트워크와 DApp이 요청하는 networkId가 다르면
 *    연결 자체가 거부된다 ("Network ID mismatch"). 사용자가 지갑에서
 *    바꿔야 하므로, 그 사실을 구분해서 알려줘야 한다.
 *
 * 3. 연결 단계 권한은 조회뿐이다(네트워크·잔액·주소). 서명은 트랜잭션마다
 *    따로 승인받는다. 제품이 주장하는 "유저가 자기 지갑으로 직접 서명"과
 *    맞는 모델이다.
 */

/** 지원 네트워크. 지갑이 알려준 목록 그대로다. */
export const NETWORK_IDS = ['undeployed', 'preview', 'preprod', 'mainnet'] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export interface DetectedWallet {
  /** 열거해서 찾은 키. 고정값으로 가정하지 않는다. */
  readonly key: string;
  readonly name: string;
  readonly rdns: string;
  readonly apiVersion: string;
  readonly api: InitialAPI;
}

export type ConnectFailure =
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'network-mismatch'; readonly wanted: NetworkId }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error'; readonly message: string };

export type ConnectResult =
  | { readonly ok: true; readonly api: ConnectedAPI; readonly wallet: DetectedWallet }
  | { readonly ok: false; readonly failure: ConnectFailure };

/** 주입된 지갑을 전부 찾는다. 키 이름에 의존하지 않는다. */
export function detectWallets(): DetectedWallet[] {
  if (typeof window === 'undefined') return [];
  const injected = window.midnight ?? {};
  return Object.entries(injected)
    .filter(([, api]) => api != null && typeof api.connect === 'function')
    .map(([key, api]) => ({
      key,
      // 지갑이 준 이름은 표시 전에 텍스트 노드로만 쓴다 (XSS 방지)
      name: String(api.name ?? '(이름 없음)'),
      rdns: String(api.rdns ?? ''),
      apiVersion: String(api.apiVersion ?? ''),
      api,
    }));
}

function classify(error: unknown): ConnectFailure {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (/network id mismatch/i.test(message)) {
    return { kind: 'network-mismatch', wanted: 'preprod' };
  }
  if (/reject|denied|cancel/i.test(message)) return { kind: 'rejected' };
  return { kind: 'error', message };
}

/**
 * 지갑에 연결한다.
 *
 * 승인 팝업이 뜨고 사용자가 계정을 고른 뒤 승인해야 완료된다.
 * 그 전까지 Promise는 pending 상태로 남는다.
 */
export async function connectWallet(networkId: NetworkId): Promise<ConnectResult> {
  const wallets = detectWallets();
  const wallet = wallets[0];
  if (!wallet) return { ok: false, failure: { kind: 'no-wallet' } };

  try {
    const api = await wallet.api.connect(networkId);

    /*
     * SDK 전역 네트워크 식별자를 여기서 설정한다.
     *
     * 이게 빠지면 배포가 "Network ID has not been configured"로 죽는다.
     * 연결 성공 지점이 유일하게 확실한 설정 시점이라 여기에 둔다.
     * 요청한 networkId가 아니라 **지갑이 보고한 값**을 쓴다. 둘이 다르면
     * 지갑이 맞고, 우리가 고집하면 주소 인코딩이 어긋난다.
     */
    adoptNetworkId((await api.getConfiguration()).networkId);

    return { ok: true, api, wallet };
  } catch (error: unknown) {
    const failure = classify(error);
    return {
      ok: false,
      failure:
        failure.kind === 'network-mismatch' ? { kind: 'network-mismatch', wanted: networkId } : failure,
    };
  }
}

/** 실패 사유를 사용자가 행동할 수 있는 문장으로 바꾼다. */
export function describeFailure(failure: ConnectFailure): string {
  switch (failure.kind) {
    case 'no-wallet':
      return 'Midnight 지갑이 없습니다. Chrome에 Lace를 설치하고 페이지를 새로고침하세요.';
    case 'network-mismatch':
      return `지갑이 다른 네트워크에 있습니다. Lace 설정에서 네트워크를 ${failure.wanted}로 바꾸세요.`;
    case 'rejected':
      return '지갑에서 연결을 승인하지 않았습니다.';
    case 'error':
      return `연결 실패: ${failure.message}`;
  }
}
