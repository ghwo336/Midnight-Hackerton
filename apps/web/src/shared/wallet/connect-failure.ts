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
  | { readonly kind: 'syncing' }
  | { readonly kind: 'fee-declined' }
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

/**
 * 지갑이 아직 동기화 중인가.
 *
 * **이건 고칠 것이 없는 상태다. 기다리면 된다.** 그런데 화면이 다른 실패와
 * 똑같이 보여주면, 읽는 사람은 설정을 뒤지기 시작한다. 실제로 1am 이 faucet
 * 자금을 받은 직후에 이렇게 말한다.
 *
 *   Wallet is syncing — open 1AM and wait for sync to finish
 *
 * 되는 것과 안 되는 것 사이에 "아직" 을 두는 것은 이 저장소가 공격 판정에
 * '판정 불가' 를 두는 것과 같은 이유다. 섞으면 원인을 못 찾는다.
 */
export function isSyncing(message: string): boolean {
  return /\bsyncing\b|\bsynchroniz|still\s+sync|wait for sync/i.test(message);
}

/**
 * 지갑이 "앞 트랜잭션이 아직 pending" 이라며 거부했는가.
 *
 * 1am 이 실제로 이렇게 말한다 (2026-09-24 관측).
 *
 *   A transaction is already pending.
 *   Wait for it to confirm or expire before requesting another.
 *
 * **지갑이 트랜잭션을 직렬화한다는 뜻이다.** 초기 설정은 이미 순차로 돌지만,
 * 회로 호출은 제출이 끝나면 반환되고 지갑은 그 뒤로도 확정을 볼 때까지
 * pending 으로 잡는다. 그래서 다음 단계가 거부된다.
 *
 * 이건 기다리면 풀리는 상태이고, **아무것도 제출되지 않았다** — 거부가
 * 제출 이전이므로 다시 시도해도 이중 제출이 아니다.
 *
 * A5(동시 신청)에 그대로 걸린다. 두 건을 정말 동시에 내야 하는데 지갑이
 * 직렬화하면 진 쪽이 회로에 닿지 못하고 죽는다. 그건 '통과' 도 '실패' 도
 * 아닌 **판정 불가** 다 (docs/ONCE_HANDOFF_final.md §7.1).
 */
export function isTransactionPending(message: string): boolean {
  return /transaction is already pending|already pending.*confirm|pending.*before requesting another/i.test(
    message,
  );
}

/**
 * 수수료(DUST) 지불 승인이 거부됐는가.
 *
 * 1am 이 이렇게 말한다 (2026-09-24 관측).
 *
 *   User declined to pay dust fee
 *
 * 일반 거부와 갈라 두는 이유는 사람이 할 일이 다르기 때문이다. 연결 승인을
 * 안 한 것이라면 다시 누르면 되지만, 이건 **DUST 가 모자라서 지갑이 물어본
 * 것일 수도 있다.** 잔액을 보라고 말해 줘야 한다.
 */
export function isFeeDeclined(message: string): boolean {
  return /declin\w*\s+to\s+pay|dust\s+fee|fee\s+(was\s+)?(declined|rejected)/i.test(message);
}

/**
 * 사용자가 승인을 거부했는가.
 *
 * "declin" 이 빠져 있어서 1am 의 "User declined …" 를 놓쳤다. 지갑마다
 * 쓰는 낱말이 다르니 넓게 잡는다.
 */
export function isRejection(message: string): boolean {
  return /reject|declin|denied|dismiss|cancel|abort/i.test(message);
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
  if (isSyncing(message)) return { kind: 'syncing' };
  // 수수료 거부를 먼저 본다. 일반 거부 패턴에도 걸리지만 할 일이 다르다.
  if (isFeeDeclined(message)) return { kind: 'fee-declined' };
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
    case 'syncing':
      return '지갑이 아직 동기화 중입니다. 지갑을 열어 둔 채로 끝나기를 기다렸다가 다시 연결하세요. 설정 문제가 아닙니다.';
    case 'fee-declined':
      return '지갑이 수수료(DUST) 지불 승인을 받지 못했습니다. 승인 창을 놓쳤다면 다시 시도하고, 계속 그러면 /devtools 패널에서 DUST 잔액이 0이 아닌지 확인하세요.';
    case 'rejected':
      return '지갑에서 연결을 승인하지 않았습니다.';
    case 'error':
      return `연결 실패: ${failure.message}`;
  }
}
