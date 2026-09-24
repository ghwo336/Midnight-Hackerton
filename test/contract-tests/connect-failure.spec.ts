import { describe, expect, it } from 'vitest';
import {
  classifyConnectError, describeFailure, isNetworkMismatch, isSyncing,
} from '../../apps/web/src/shared/wallet/connect-failure.js';

/**
 * 지갑 연결 실패 분류.
 *
 * 이 분류가 틀리면 화면이 엉뚱한 지시를 한다. 네트워크를 바꾸면 되는
 * 상황에서 원문 오류를 그대로 보여주면, 읽는 사람은 그게 코드 문제인지
 * 설정 문제인지 모른다.
 *
 * 실제로 1AM 에서 한 번 빠져나갔다. Lace 의 "Network ID mismatch" 만 보고
 * 있었는데 1AM 은 "Network mismatch. Wallet is on mainnet, requested
 * preprod." 라고 한다. "ID" 가 없어서 error 갈래로 떨어졌다.
 */
describe('지갑 연결 실패 분류', () => {
  /** 실제로 지갑들이 뱉은 문자열. 추측이 아니라 관측된 것만 넣는다. */
  const MISMATCH_MESSAGES = [
    // 1AM (2026-09-21 이 저장소에서 직접 관측)
    'Network mismatch. Wallet is on mainnet, requested preprod. Switch networks in 1AM and try again.',
    // Lace (SPIKE S6-a)
    'Network ID mismatch',
    'network id mismatch: expected preprod',
  ] as const;

  it.each(MISMATCH_MESSAGES)('네트워크 불일치로 분류한다: %s', (message) => {
    expect(isNetworkMismatch(message)).toBe(true);
    expect(classifyConnectError(new Error(message)).kind).toBe('network-mismatch');
  });

  it('네트워크 불일치는 지갑에서 무엇을 바꿀지 말해준다', () => {
    const text = describeFailure({ kind: 'network-mismatch', wanted: 'preprod' });
    expect(text).toContain('preprod');
    expect(text).toContain('지갑 설정');
  });

  it('승인 거부를 네트워크 문제로 오인하지 않는다', () => {
    const failure = classifyConnectError(new Error('User rejected the request'));
    expect(failure.kind).toBe('rejected');
  });

  /*
   * 모르는 오류를 네트워크 문제로 뭉뚱그리면, 네트워크를 바꿔 봐도 안 되는
   * 사람이 원인을 못 찾는다. 모르는 것은 모른다고 하고 원문을 보여준다.
   */
  it('관계없는 오류는 원문을 그대로 남긴다', () => {
    const failure = classifyConnectError(new Error('proof server unreachable'));
    expect(failure).toEqual({ kind: 'error', message: 'proof server unreachable' });
    expect(describeFailure(failure)).toContain('proof server unreachable');
  });

  it('Error 가 아닌 것을 던져도 죽지 않는다', () => {
    expect(classifyConnectError('Network mismatch').kind).toBe('network-mismatch');
    expect(classifyConnectError(undefined).kind).toBe('error');
  });

  /*
   * 동기화 중은 **고칠 것이 없는 상태다.** 다른 실패와 섞으면 사람이
   * 설정을 뒤진다. 되는 것과 안 되는 것 사이에 "아직" 을 두는 것은
   * 공격 판정에 '판정 불가' 를 두는 것과 같은 이유다.
   */
  it('동기화 중을 설정 오류와 구분한다', () => {
    // 1am 이 faucet 직후 실제로 뱉은 문자열 (2026-09-24 관측)
    const message = 'Wallet is syncing — open 1AM and wait for sync to finish';
    expect(isSyncing(message)).toBe(true);
    expect(classifyConnectError(new Error(message)).kind).toBe('syncing');
  });

  it('동기화 중 안내는 기다리라고 말하고 설정을 의심하게 하지 않는다', () => {
    const text = describeFailure({ kind: 'syncing' });
    expect(text).toContain('기다');
    expect(text).toContain('설정 문제가 아닙니다');
  });

  it('동기화와 네트워크 불일치를 서로 오인하지 않는다', () => {
    expect(isSyncing('Network mismatch. Wallet is on mainnet, requested preprod.')).toBe(false);
    expect(isNetworkMismatch('Wallet is syncing — wait for sync to finish')).toBe(false);
  });

  it('지갑 없음 안내에 특정 제품만 박지 않는다', () => {
    const text = describeFailure({ kind: 'no-wallet' });
    expect(text).toContain('1am');
    expect(text).toContain('Lace');
  });
});
