'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  CostModel, DustActions, DustRegistration, Intent, SignatureEnabled, Transaction,
  type PreProof, type Signature, type SignatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v8';
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * NIGHT 을 DUST 생성에 등록한다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────
 *
 * DUST 는 NIGHT 을 들고만 있으면 생기는 게 아니다. 원장 스펙:
 *
 *   "A new DUST UTXO is created if and only if a NIGHT UTXO is created
 *    and its key has a table entry."
 *
 * 그 table entry 를 만드는 것이 DustRegistration 이다. 등록이 없으면
 * getDustBalance() 의 cap 이 0 으로 나오고, 수수료를 낼 수 없어 어떤
 * 트랜잭션도 제출하지 못한다.
 *
 * ── 수수료는 어떻게 내나 (자기자금 등록) ───────────────────
 *
 * 등록하려면 트랜잭션을 내야 하고, 트랜잭션에는 수수료가 들고, 수수료는
 * DUST 로 낸다. 닭과 달걀처럼 보이지만 스펙에 탈출구가 있다.
 *
 *   등록하는 night 주소의 unshielded 입력이 **같은 트랜잭션 안에** 있고
 *   그 입력이 아직 DUST 를 생성하고 있지 않았다면, 그 입력이 생성했을
 *   DUST 를 소급 계산해 allowFeePayment 한도까지 수수료로 쓴다.
 *
 * 그래서 이 트랜잭션은 NIGHT 을 자기 자신에게 보내는 입출력을 포함한다.
 * 자금은 그대로지만 그 입력이 소급 DUST 를 만들어 수수료를 낸다.
 *
 * ── 확실하지 않은 지점 ─────────────────────────────────────
 *
 * 커넥터의 signData 는 "data to sign will be prepended with right prefix"
 * 라고 문서화돼 있다. 원장이 검증하는 것은 Intent.signatureData() 의
 * 원시 바이트이므로, 지갑이 붙이는 접두사가 그것과 다르면 서명이 맞지
 * 않는다. Node 지갑 SDK 는 원시 바이트를 그대로 서명받는다
 * (signDustRegistration: (payload: Uint8Array) => Signature).
 *
 * 실제로 제출해 봐야 갈린다. 실패하면 어느 단계에서 무엇이 틀렸는지
 * 그대로 남긴다.
 */

/** 네이티브 토큰(NIGHT)의 토큰 타입. 32바이트 0. */
const NIGHT = '0'.repeat(64);

/** 이 등록으로 수수료에 쓸 수 있는 DUST 상한. 넉넉히 잡는다. */
const ALLOW_FEE_PAYMENT = 10_000_000_000_000_000n;

/** 이 트랜잭션이 들어가야 하는 세그먼트. makeIntent 에 넘기는 값과 같아야 한다. */
const SEGMENT = 1;

export interface RegistrationStep {
  readonly label: string;
  readonly detail?: string;
}

export interface RegistrationResult {
  readonly ok: boolean;
  readonly steps: readonly RegistrationStep[];
  readonly error?: string;
}

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

function describe(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  const text = String(error);
  return text === '[object Object]' ? JSON.stringify(error).slice(0, 300) : text;
}

export async function registerForDust(api: ConnectedAPI): Promise<RegistrationResult> {
  const steps: RegistrationStep[] = [];
  const note = (label: string, detail?: string) => {
    steps.push(detail === undefined ? { label } : { label, detail });
  };

  try {
    const [{ dustAddress }, { unshieldedAddress }, balances, before, config] = await Promise.all([
      api.getDustAddress(),
      api.getUnshieldedAddress(),
      api.getUnshieldedBalances(),
      api.getDustBalance(),
      api.getConfiguration(),
    ]);
    note('주소 조회', `dust=${dustAddress.slice(0, 20)}…`);
    note('등록 전 DUST', `balance=${before.balance} cap=${before.cap}`);

    const night = balances[NIGHT] ?? 0n;
    if (night === 0n) {
      return { ok: false, steps, error: 'NIGHT 잔액이 0이다. 등록할 대상이 없다.' };
    }
    note('NIGHT 잔액', night.toString());

    /*
     * night 검증키를 먼저 알아야 한다.
     *
     * DustRegistration 이 nightKey 를 품고, 서명 대상인 Intent.signatureData()
     * 는 그 registration 을 포함해 직렬화된다. 즉 키를 모르면 서명할 바이트를
     * 만들 수 없다. signData 가 verifyingKey 를 함께 돌려주므로 버리는 서명을
     * 한 번 해서 키만 얻는다. 지갑 승인이 한 번 더 뜨는 이유다.
     */
    const probe = await api.signData('00', { encoding: 'hex', keyType: 'unshielded' });
    const nightKey = probe.verifyingKey as SignatureVerifyingKey;
    note('night 검증키 확보', `${nightKey.slice(0, 20)}…`);

    /*
     * 트랜잭션을 직접 조립한다.
     *
     * 처음엔 makeIntent() 로 지갑에 만들게 하고 거기에 dust 항목을 붙이려
     * 했는데, makeIntent 는 이미 proof 와 binding 이 붙은 sealed 트랜잭션을
     * 돌려준다. 실패 메시지가 그걸 정확히 알려줬다:
     *
     *   기대 signature, proof-preimage, embedded-fr
     *   실제 signature, proof,          pedersen-schnorr
     *
     * sealed 트랜잭션은 내용을 바꿀 수 없다. 바꾸면 binding 이 깨진다.
     * 그래서 등록만 담은 intent 를 새로 만들고 잔액 조정을 지갑에 맡긴다.
     */
    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const intent = Intent.new(ttl);

    // bech32m 문자열을 DustPublicKey(bigint)로 되돌린다.
    const dustPublicKey = DustAddress.codec.decode(
      config.networkId,
      MidnightBech32m.parse(dustAddress),
    ).data;

    const registration = new DustRegistration<SignatureEnabled>(
      'signature', nightKey, dustPublicKey, ALLOW_FEE_PAYMENT,
    );
    intent.dustActions = new DustActions<SignatureEnabled, PreProof>(
      'signature', 'pre-proof', new Date(), [], [registration],
    );
    note('등록 항목 첨부', `allowFeePayment=${ALLOW_FEE_PAYMENT}`);

    const payload = intent.signatureData(SEGMENT);
    note('서명 대상', `${payload.length} bytes`);

    const signed = await api.signData(toHex(payload), {
      encoding: 'hex', keyType: 'unshielded',
    });
    registration.signature = new SignatureEnabled(signed.signature as Signature);
    note('서명 완료');

    const unproven = Transaction.fromParts(config.networkId, undefined, undefined, intent);
    note('트랜잭션 조립');

    /*
     * 증명 단계. 이 트랜잭션에는 회로 호출이 없으므로 키를 물어볼 일이
     * 없다. 그래도 물어보면 그 사실 자체가 단서이므로 그대로 던진다.
     */
    const provingProvider = await api.getProvingProvider({
      getZKIR: (loc) => Promise.reject(new Error(`예상치 못한 ZKIR 요청: ${loc}`)),
      getProverKey: (loc) => Promise.reject(new Error(`예상치 못한 증명키 요청: ${loc}`)),
      getVerifierKey: (loc) => Promise.reject(new Error(`예상치 못한 검증키 요청: ${loc}`)),
    });
    const proven = await unproven.prove(provingProvider, CostModel.initialCostModel());
    note('증명 완료');

    const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(proven.serialize()));
    note('잔액 조정 완료');

    await api.submitTransaction(balanced);
    note('제출 완료');

    const after = await api.getDustBalance();
    note('등록 후 DUST', `balance=${after.balance} cap=${after.cap}`);

    return { ok: true, steps };
  } catch (error: unknown) {
    return { ok: false, steps, error: describe(error) };
  }
}
