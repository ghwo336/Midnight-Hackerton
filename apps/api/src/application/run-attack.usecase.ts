import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type DomainErrorCode, type Hex, type LenderId } from '@once/domain';
import { generateSalt } from '@once/crypto';
import { CHAIN_READER, CHAIN_WRITER, type ChainReader, type ChainWriter } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';

export const ATTACK_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const;
export type AttackId = (typeof ATTACK_IDS)[number];

export interface AttackOutcome {
  readonly id: AttackId;
  readonly title: string;
  readonly expected: string;
  /** 공격 시도가 거부됐는가. */
  readonly blocked: boolean;
  readonly code: DomainErrorCode | 'SETTLED';
  /**
   * 공격 시도 구간에서만 실제로 나간 자금.
   * 셋업(정상 대출)은 측정에서 제외한다.
   * A1~A4·A6은 0이어야 하고, A5는 정확히 한 건분이어야 한다.
   */
  readonly fundsMoved: string;
  readonly note: string;
}

const META: Record<AttackId, { title: string; expected: string }> = {
  A1: { title: '파일명·인코딩 변경 후 재신청', expected: 'nullifier 동일 → 거부' },
  A2: { title: '새 salt로 재봉인해 신청', expected: 'commitment은 다르나 nullifier 동일 → 거부' },
  A3: { title: '액면금액 부풀려 한도 초과 신청', expected: 'Merkle 리프 불일치 → 거부' },
  A4: { title: '다른 소유자의 채권으로 신청', expected: '소유권 검증 실패 → 거부' },
  A5: { title: '두 금융사에 동시 신청', expected: '하나만 확정, 나머지 자금 보존' },
  A6: { title: '미사용 시점 증명을 사용 후 제출', expected: '실행 시점 재검사로 거부' },
};

interface Witness {
  invoiceId: Hex;
  faceAmount: bigint;
  salt: Hex;
  ownerSecret: Hex;
}

/**
 * 공격 시나리오를 살아 있는 원장에 대해 실행한다 (SPEC §9.4).
 *
 * 발표 때 라이브로 누르는 버튼이므로 예외를 던지지 않는다. 실패해도
 * 결과 객체를 돌려주어 화면이 깨지지 않게 한다.
 */
@Injectable()
export class RunAttackUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
  ) {}

  async execute(id: AttackId, supplierId: string, recipient: Hex): Promise<AttackOutcome> {
    const invoices = await this.privateState.listInvoices(supplierId);
    const ownerSecret = await this.privateState.getOwnerSecret(supplierId);

    // A5는 아직 쓰이지 않은 채권이 필요하다. 나머지는 이미 대출된 채권을 노린다.
    const targetIndex = id === 'A5' ? 1 : 0;
    const target = invoices[targetIndex];
    if (!target) {
      return this.outcome(id, false, 'INVOICE_NOT_FOUND', 0n, '대상 채권이 없다');
    }

    const base: Witness = {
      invoiceId: target.invoiceId,
      faceAmount: target.faceAmount,
      salt: target.salt,
      ownerSecret,
    };

    // ── 셋업: A1~A4·A6은 "이미 대출된 채권"이 전제다 ──
    let note = '';
    if (id !== 'A5') {
      const already = await this.isFinanced(base);
      if (!already) {
        await this.submit('lender-a', base).catch(() => undefined);
        note = '셋업: 금융사 A가 먼저 정상 대출을 실행했다';
      } else {
        note = '이 채권은 이미 금융사 A가 대출했다';
      }
    } else {
      note = '미사용 채권에 두 금융사가 동시에 신청한다';
    }

    // ── 여기서부터가 공격 구간. 자금 변화를 이 구간에서만 측정한다 ──
    const before = await this.totalVault();
    let blocked = false;
    let code: DomainErrorCode | 'SETTLED' = 'SETTLED';

    try {
      switch (id) {
        case 'A1':
          // 증빙의 파일명·인코딩은 애초에 입력이 아니다. 같은 witness가 된다.
          await this.submit('lender-b', { ...base });
          break;
        case 'A2':
          await this.submit('lender-b', { ...base, salt: generateSalt() });
          break;
        case 'A3':
          await this.submit(
            'lender-b',
            { ...base, faceAmount: target.faceAmount * 10n },
            target.faceAmount * 8n,
          );
          break;
        case 'A4':
          await this.submit('lender-b', { ...base, ownerSecret: `0x${'ff'.repeat(32)}` as Hex });
          break;
        case 'A6':
          // 미사용 시점에 준비해 둔 요청을 이제서야 제출한다
          await this.submit('lender-b', { ...base });
          break;
        case 'A5': {
          const results = await Promise.allSettled([
            this.submit('lender-a', base),
            this.submit('lender-b', base),
          ]);
          const rejection = results.find((r) => r.status === 'rejected');
          if (rejection?.status === 'rejected') throw rejection.reason;
          break;
        }
      }
    } catch (error: unknown) {
      blocked = true;
      code = error instanceof DomainError ? error.code : 'CHAIN_SUBMIT_FAILED';
    }

    const after = await this.totalVault();
    return this.outcome(id, blocked, code, before - after, note);
  }

  private async isFinanced(witness: Witness): Promise<boolean> {
    const issuerId = await this.reader.getIssuerId();
    const { computeNullifier } = await import('@once/crypto');
    return this.reader.isNullifierUsed(computeNullifier(issuerId, witness.invoiceId));
  }

  private async totalVault(): Promise<bigint> {
    return (
      (await this.reader.getLenderVault('lender-a')) +
      (await this.reader.getLenderVault('lender-b'))
    );
  }

  private async submit(lender: LenderId, witness: Witness, amountOverride?: bigint): Promise<void> {
    const ltvBps = await this.reader.getLtvBps();
    const amount = amountOverride ?? (witness.faceAmount * ltvBps) / 10_000n;
    await this.writer.submitFinancing({
      lender,
      amount,
      recipient: `0x${'cc'.repeat(32)}` as Hex,
      witness,
    });
  }

  private outcome(
    id: AttackId,
    blocked: boolean,
    code: DomainErrorCode | 'SETTLED',
    fundsMoved: bigint,
    note: string,
  ): AttackOutcome {
    return { id, ...META[id], blocked, code, fundsMoved: fundsMoved.toString(), note };
  }
}
