'use client';

import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

/**
 * Midnight SDK의 전역 네트워크 식별자.
 *
 * SDK는 주소 인코딩과 트랜잭션 구성에 이 값을 쓰고, 설정되지 않은 채로
 * 컨트랙트 연산을 부르면 다음과 같이 던진다.
 *
 *   Network ID has not been configured.
 *   Call setNetworkId() before any wallet or contract operation.
 *
 * Node 경로는 `apps/deploy/src/config.ts`의 `useNetwork()`가 이걸 했다.
 * 브라우저 경로로 옮길 때 그 한 줄이 따라오지 않아 첫 배포가 실패했다.
 *
 * **값을 하드코딩하지 않는다.** 지갑이 `getConfiguration().networkId`로
 * 알려준 값을 그대로 쓴다. 지갑은 Preprod인데 코드가 다른 값을 넣으면
 * 주소 인코딩이 어긋나고 다시 mismatch로 막힌다.
 */

/**
 * 지갑이 보고한 네트워크를 SDK에 알린다. 여러 번 불러도 안전하다.
 *
 * @param reported `api.getConfiguration().networkId`
 */
export function adoptNetworkId(reported: string): string {
  const id = reported.trim();
  if (id === '') {
    throw new Error('지갑이 networkId를 알려주지 않았다. 연결을 다시 시도한다.');
  }
  // 이미 같은 값이면 다시 쓰지 않는다. 다른 값이면 지갑 쪽이 바뀐 것이므로
  // 지갑을 따라간다. DApp이 고집할 이유가 없다.
  if (currentNetworkId() !== id) setNetworkId(id);
  return id;
}

/** 설정돼 있으면 값을, 아니면 null. 던지지 않는다. */
export function currentNetworkId(): string | null {
  try {
    return getNetworkId();
  } catch {
    return null;
  }
}

/**
 * 회로 호출 직전에 부른다. 설정이 빠진 채로 진행하지 않게 한다.
 *
 * 연결 시점에 한 번 설정하는 것만으로는 부족하다. 페이지가 다시 로드되거나
 * 연결 없이 이 경로에 들어오면 전역이 비어 있다. 그때 SDK 안쪽에서
 * 터지는 대신 여기서 행동 가능한 문장으로 멈춘다.
 */
export function requireNetworkId(): string {
  const id = currentNetworkId();
  if (id === null) {
    throw new Error(
      '네트워크가 설정되지 않았다. 지갑을 연결하면 지갑이 보고한 networkId로 설정된다.',
    );
  }
  return id;
}
