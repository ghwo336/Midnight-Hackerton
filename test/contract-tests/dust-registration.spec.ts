import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { registerForDust } from '../../apps/web/src/shared/wallet/dust-registration.js';

/**
 * DUST 등록의 **진단 능력**을 시험한다.
 *
 * 등록 자체는 실제 지갑과 네트워크가 있어야 하므로 여기서 성공까지 갈 수
 * 없다. 그런데 이 코드는 역할을 하나 더 떠맡고 있다 — 지갑이 어느 커넥터
 * 메서드를 구현하지 않았는지 알려주는 것이다. Lace 기준으로 짠 코드를 다른
 * 지갑에서 처음 돌릴 때, 사람은 단계 로그만 보고 원인을 짚는다
 * (docs/DEPLOY.md §2 진단표).
 *
 * **그 진단표가 맞는지는 아무도 확인한 적이 없었고, 실제로 한 줄이 틀려
 * 있었다.** getProvingProvider 는 '서명 완료' 가 아니라 '트랜잭션 조립'
 * 다음에 불린다. 표를 믿고 고치면 엉뚱한 곳을 본다. 그래서 표를 코드에서
 * 유도해 고정한다.
 */
const SOURCE = new URL('../../apps/web/src/shared/wallet/dust-registration.ts', import.meta.url);

/**
 * 진단표의 정본.
 *
 * 왼쪽이 커넥터 메서드, 오른쪽이 그게 실패했을 때 **마지막으로 찍히는 줄**
 * 이다. null 은 아직 아무 줄도 안 찍혔다는 뜻이다.
 *
 * docs/DEPLOY.md §2 와 docs/ONCE_HANDOFF_final.md §4.5 의 표가 이것과 같아야
 * 한다. 아래 구조 테스트가 이 표를 소스에서 다시 유도해 대조한다.
 */
const DIAGNOSIS: readonly (readonly [method: string, lastLabel: string | null])[] = [
  ['getDustAddress', null],
  ['getUnshieldedBalances', null],
  ['signData', 'NIGHT 잔액'],
  ['getProvingProvider', '트랜잭션 조립'],
  ['balanceUnsealedTransaction', '증명 완료'],
  ['submitTransaction', '잔액 조정 완료'],
];

function fakeWallet(overrides: Record<string, unknown> = {}): ConnectedAPI {
  const base = {
    getDustAddress: async () => ({ dustAddress: 'mn_dust_preprod1qqqqqqqqqqqqqqqqqqqq' }),
    getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr_preprod1zzzz' }),
    getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 5_000n }),
    getDustBalance: async () => ({ balance: 0n, cap: 0n }),
    getConfiguration: async () => ({ networkId: 'preprod' }),
    signData: async () => ({ signature: '00', verifyingKey: 'aa'.repeat(32) }),
    getProvingProvider: async () => ({}),
    balanceUnsealedTransaction: async () => ({ tx: 'ff' }),
    submitTransaction: async () => 'txhash',
  };
  return { ...base, ...overrides } as unknown as ConnectedAPI;
}

const labels = (r: Awaited<ReturnType<typeof registerForDust>>) => r.steps.map((s) => s.label);

describe('DUST 등록: 진단표가 코드와 일치한다', () => {
  /*
   * 구조로 검사한다.
   *
   * 행동으로 끝까지 밀어 보려면 유효한 bech32m dust 주소와 실제 ledger
   * 객체가 있어야 한다 — 가짜 주소는 Intent 조립 단계에서 디코딩에 걸려
   * 그 앞에서 멈춘다. 그래서 뒷부분은 소스의 호출 순서로 확인한다.
   * 이게 "테스트가 무엇을 확인하는가" 에 대한 정직한 답이다.
   */
  it('각 메서드 호출 직전의 마지막 note 가 진단표와 같다', async () => {
    const text = await readFile(SOURCE, 'utf8');

    /** 소스를 위에서 훑으며, 각 api 호출 시점의 직전 note 라벨을 기록한다. */
    const derived = new Map<string, string | null>();
    let lastLabel: string | null = null;
    for (const line of text.split('\n')) {
      const note = /note\('([^']+)'/.exec(line);
      if (note?.[1] !== undefined) lastLabel = note[1];
      const call = /api\.(\w+)\(/.exec(line);
      if (call?.[1] !== undefined && !derived.has(call[1])) derived.set(call[1], lastLabel);
    }

    // 파싱이 빈손이면 아래 비교가 조용히 통과한다. 먼저 막는다.
    expect(derived.size, '소스에서 api 호출을 하나도 못 찾았다. 정규식을 볼 것').toBeGreaterThan(5);

    for (const [method, expected] of DIAGNOSIS) {
      expect(derived.get(method), `${method} 실패 시 마지막으로 찍히는 줄`).toBe(expected);
    }
  });

  it('문서의 진단표가 코드와 어긋나지 않는다', async () => {
    const deploy = await readFile(new URL('../../docs/DEPLOY.md', import.meta.url), 'utf8');
    /*
     * 표 전체를 파싱하지는 않는다. 한때 틀렸던 짝만 고정한다 —
     * getProvingProvider 는 '트랜잭션 조립' 다음이지 '서명 완료' 다음이 아니다.
     */
    const row = deploy.split('\n').find((l) => l.includes('getProvingProvider'));
    expect(row, 'DEPLOY.md §2 에 getProvingProvider 행이 없다').toBeDefined();
    expect(row).toContain('트랜잭션 조립');
  });
});

describe('DUST 등록: 실패해도 진단이 남는다', () => {
  it('NIGHT 이 0 이면 지갑 승인을 요구하기 전에 멈춘다', async () => {
    const result = await registerForDust(
      fakeWallet({ getUnshieldedBalances: async () => ({ ['0'.repeat(64)]: 0n }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('NIGHT 잔액이 0이다');
    /*
     * 승인 창을 띄운 뒤에 "받을 게 없다" 고 하면 안 된다. 누르기 전에
     * 막히는 것과 누른 뒤에 거절당하는 것은 사용자에게 전혀 다른 일이다.
     */
    expect(labels(result)).not.toContain('night 검증키 확보');
  });

  it.each([
    ['getDustAddress', null],
    ['signData', 'NIGHT 잔액'],
  ] as const)('%s 가 없으면 로그가 거기서 멈추고 메서드 이름이 남는다', async (method, lastLabel) => {
    const result = await registerForDust(
      fakeWallet({ [method]: async () => { throw new Error(`${method} is not supported`); } }),
    );
    expect(result.ok).toBe(false);
    const seen = labels(result);
    if (lastLabel === null) expect(seen).toEqual([]);
    else expect(seen[seen.length - 1]).toBe(lastLabel);
    // 사유 없는 실패는 진단이 아니다.
    expect(result.error).toContain(method);
  });

  it('signData 가 verifyingKey 를 빠뜨리면 제출까지 가지 않는다', async () => {
    /*
     * 가장 조용한 실패다. 서명은 성공했는데 키가 없다. undefined 를 들고
     * 계속 가면 한참 뒤 엉뚱한 곳에서 터진다.
     */
    const result = await registerForDust(fakeWallet({ signData: async () => ({ signature: '00' }) }));
    expect(result.ok).toBe(false);
    expect(labels(result)).not.toContain('제출 완료');
  });

  it('무엇을 던지든 함수는 던지지 않는다', async () => {
    /*
     * 화면이 반환값으로 단계 로그를 그린다. 던져 버리면 어디까지 갔는지가
     * 통째로 사라지고 사용자는 스택 트레이스만 본다.
     */
    for (const thrown of [new Error('boom'), { code: -32603 }, 'nope', undefined]) {
      const result = await registerForDust(
        fakeWallet({ getConfiguration: async () => { throw thrown; } }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBeTypeOf('string');
      expect(result.error).not.toBe('');
      expect(result.error).not.toBe('[object Object]');
    }
  });
});
