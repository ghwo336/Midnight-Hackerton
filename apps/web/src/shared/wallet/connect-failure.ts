/**
 * 지갑 연결 실패를 사용자가 행동할 수 있는 형태로 분류한다.
 *
 * **Midnight SDK 를 끌어오지 않는 자리에 둔다.** 분류 규칙은 지갑이 주는
 * 문자열에 달려 있어서 지갑마다 깨지기 쉽고, 그래서 테스트가 필요하다.
 * connect.ts 는 SDK 를 import 하므로 거기 두면 Node 테스트에서 못 읽는다
 * (demo-fixtures.ts 와 같은 이유).
 */

/** 지원 네트워크. 지갑이 알려준 목록 그대로다. */
export const NETWORK_IDS = ['undeployed', 'preview', 'preprod', 'mainnet'] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export type ConnectFailure =
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'network-mismatch'; readonly wanted: NetworkId }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * 네트워크 불일치인가.
 *
 * 지갑마다 문구가 다르다. 한때는 Lace 의 "Network ID mismatch" 하나만 보고
 * 있었는데, 1AM 은 이렇게 말한다.
 *
 *   Network mismatch. Wallet is on mainnet, requested preprod.
 *
 * "ID" 가 없어서 그 패턴을 빠져나갔고, 사용자는 분류된 안내 대신 원문을
 * 그대로 받았다. 마침 1AM 의 문구가 친절해서 티가 안 났을 뿐이다.
 * 지갑이 늘어날 때마다 같은 일이 생기므로 넓게 잡는다.
 */
export function isNetworkMismatch(message: string): boolean {
  return (
    /network\s*(id)?\s*mismatch/i.test(message) ||
    /wallet is on \S+.*request/i.test(message) ||
    /wrong network/i.test(message)
  );
}

/** 사용자가 승인을 거부했는가. */
export function isRejection(message: string): boolean {
  return /reject|denied|cancel/i.test(message);
}

/** 던져진 값에서 메시지를 뽑는다. 지갑은 Error 가 아닌 것도 던진다. */
export function messageOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
}

export function classifyConnectError(error: unknown): ConnectFailure {
  const message = messageOf(error);
  if (isNetworkMismatch(message)) return { kind: 'network-mismatch', wanted: 'preprod' };
  if (isRejection(message)) return { kind: 'rejected' };
  return { kind: 'error', message };
}

/**
 * 실패 사유를 사용자가 행동할 수 있는 문장으로 바꾼다.
 *
 * 지갑 제품명을 박지 않는다. 어느 지갑에 붙었는지는 패널이 이름을 읽어
 * 따로 보여준다.
 */
export function describeFailure(failure: ConnectFailure): string {
  switch (failure.kind) {
    case 'no-wallet':
      return 'Midnight 지갑이 없습니다. Chrome에 Midnight 지갑 확장(Lace · 1am 등)을 설치하고 페이지를 새로고침하세요.';
    case 'network-mismatch':
      return `지갑이 다른 네트워크에 있습니다. 지갑 설정에서 네트워크를 ${failure.wanted}로 바꾸고 다시 연결하세요.`;
    case 'rejected':
      return '지갑에서 연결을 승인하지 않았습니다.';
    case 'error':
      return `연결 실패: ${failure.message}`;
  }
}
