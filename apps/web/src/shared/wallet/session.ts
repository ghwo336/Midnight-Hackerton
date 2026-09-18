import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/**
 * 화면이 들고 다니는 지갑 손잡이.
 *
 * **화면은 이 값의 안을 들여다보지 않는다.** 받아서 `shared/wallet` 의
 * 함수에 그대로 넘기기만 한다. 체인 SDK 를 화면에서 직접 쓰지 않는다는
 * 규칙(SPEC §9.2)을 지키면서, 서명이 필요한 동작을 화면에서 시작할 수
 * 있게 하는 유일한 통로다.
 *
 * 타입을 여기서 한 번만 다시 내보내므로, 커넥터 API 가 바뀌어도 화면
 * 파일들을 고칠 일이 없다.
 */
export type WalletSession = ConnectedAPI;
