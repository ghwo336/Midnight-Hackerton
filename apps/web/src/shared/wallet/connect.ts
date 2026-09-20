'use client';

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { adoptNetworkId } from './network';
import { classifyConnectError, type ConnectFailure, type NetworkId } from './connect-failure';

/*
 * 실패 분류와 문구는 connect-failure.ts 에 있다. SDK 를 끌어오지 않는
 * 자리여야 테스트가 읽을 수 있다. 여기서 다시 내보내 호출부는 그대로 둔다.
 */
export {
  NETWORK_IDS, classifyConnectError, describeFailure, isNetworkMismatch,
} from './connect-failure';
export type { ConnectFailure, NetworkId } from './connect-failure';

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

export interface DetectedWallet {
  /** 열거해서 찾은 키. 고정값으로 가정하지 않는다. */
  readonly key: string;
  readonly name: string;
  readonly rdns: string;
  readonly apiVersion: string;
  readonly api: InitialAPI;
}

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

/**
 * 지갑에 연결한다.
 *
 * 승인 팝업이 뜨고 사용자가 계정을 고른 뒤 승인해야 완료된다.
 * 그 전까지 Promise는 pending 상태로 남는다.
 */
export async function connectWallet(networkId: NetworkId): Promise<ConnectResult> {
  const wallets = detectWallets();
  /*
   * 주입된 것 중 첫 번째를 고른다. 선택 UI 가 없다.
   *
   * 확장이 두 개 이상 깔려 있으면 열거 순서가 결정하고 그건 제어할 수 없다.
   * **지갑 확장 하나만 설치한 브라우저 프로필에서 작업해라.** 엉뚱한 지갑에
   * 연결되면 주소·네트워크는 멀쩡해 보이는데 서명 단계에서만 어긋난다.
   */
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
    const failure = classifyConnectError(error);
    return {
      ok: false,
      failure:
        failure.kind === 'network-mismatch' ? { kind: 'network-mismatch', wanted: networkId } : failure,
    };
  }
}

