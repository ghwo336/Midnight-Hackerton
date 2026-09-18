'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';

/**
 * midnight-js 의 Provider 계약과 DApp Connector 사이의 다리.
 *
 * 두 쪽이 기대하는 모양이 다르고, 그 차이가 첫 배포를 죽였다.
 *
 *   midnight-js            DApp Connector
 *   getCoinPublicKey()     getShieldedAddresses(): Promise<{...}>
 *     → 동기, 값 반환         → 비동기
 *   balanceTx(객체)         balanceUnsealedTransaction(문자열)
 *   submitTx(객체) → id     submitTransaction(문자열) → void
 *
 * 처음엔 getCoinPublicKey 를 async 로 만들어 Promise 를 돌려줬다. SDK 가
 * 그 Promise 를 bech32 로 디코드하려다 "string expected" 로 터졌다.
 * `as never` 캐스트가 타입 검사를 막고 있어서 컴파일에서 잡히지 않았다.
 * 그래서 여기서는 캐스트를 쓰지 않고 실제 인터페이스를 구현한다.
 */

/** 커넥터는 직렬화된 트랜잭션을 16진수 문자열로 주고받는다. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * 지갑 기반 Provider.
 *
 * 주소는 **미리 한 번 조회해 둔다.** midnight-js 가 동기로 읽기 때문이다.
 * 연결이 끝난 뒤 한 번 부르는 값이라 갱신할 필요도 없다.
 */
export async function createWalletBridge(
  api: ConnectedAPI,
): Promise<WalletProvider & MidnightProvider> {
  const shielded = await api.getShieldedAddresses();

  return {
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,

    /**
     * 잔액 조정과 서명을 지갑이 한다.
     *
     * 이것이 브라우저 경로가 지갑 동기화를 기다리지 않는 이유다 (S6-d).
     * Lace 가 자기 동기화 상태로 입출력을 채운다.
     */
    async balanceTx(tx, ttl) {
      void ttl;
      const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      // 돌아오는 것은 증명·서명이 붙고 바인딩까지 끝난 트랜잭션이다.
      return Transaction.deserialize('signature', 'proof', 'binding', fromHex(balanced));
    },

    /**
     * 제출도 지갑이 한다.
     *
     * 커넥터는 void 를 돌려주므로 트랜잭션 식별자를 직접 꺼낸다. 이게
     * 없으면 화면이 방금 만든 트랜잭션을 인덱서에서 찾을 수 없다.
     */
    async submitTx(tx) {
      await api.submitTransaction(toHex(tx.serialize()));
      const ids = tx.identifiers();
      const id = ids[0];
      if (id === undefined) {
        throw new Error('제출한 트랜잭션에서 식별자를 얻지 못했다');
      }
      return id;
    },
  };
}
