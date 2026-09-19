import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, webcrypto } from 'node:crypto';
import {
  bytesToHex, type Hex, type InvoiceDetail, type RiskProfile,
} from '@once/domain';
import { computeInvoiceLeaf, deriveOwnerPublicKey, generateSalt } from '@once/crypto';
import { CHAIN_READER, type ChainReader } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';
import { PENDING_ISSUANCE, type PendingIssuanceStore } from './ports/pending-issuance.js';

export interface PrepareIssuanceCommand {
  readonly supplierId: string;
  readonly faceAmount: bigint;
  readonly detail: InvoiceDetail;
  readonly risk: RiskProfile;
  /** 요청 승인 경로로 들어온 경우. 직접 발급이면 생략한다. */
  readonly requestId?: string;
}

/**
 * 브라우저가 registerInvoice 회로에 넣을 재료.
 *
 * **리프 하나뿐이다.** 채권 원문은 나가지 않는다 — 회로가 받는 것도
 * 리프 해시 하나이고, 발급 기관 화면은 이미 자기가 입력한 값을 안다.
 */
export interface IssuancePlan {
  readonly issuanceId: string;
  readonly invoiceId: Hex;
  readonly leaf: Hex;
  /** 발급 전 루트. 화면이 전후를 나란히 보여준다. */
  readonly rootBefore: Hex;
}

/**
 * 실제 체인에서는 **서버가 서명하지 않는다.**
 *
 * 발급 기관 비밀키도 서버에 없다. 회로가
 * `assert(issuerPublicKey(issuerSecret()) == issuerPk)` 를 보므로, 발급
 * 권한을 쥔 기기(그 비밀키가 IndexedDB 에 있는 브라우저)만 리프를 넣을 수
 * 있다. 서버가 할 수 있는 일은 입력을 검증하고 리프를 계산해 건네는
 * 것까지다.
 *
 * 비공개 상태에는 **아직 쓰지 않는다.** 확정된 뒤에 쓴다.
 */
@Injectable()
export class PrepareIssuanceUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(PENDING_ISSUANCE) private readonly pending: PendingIssuanceStore,
  ) {}

  async execute(cmd: PrepareIssuanceCommand): Promise<IssuancePlan> {
    const ownerSecret = await this.privateState.getOwnerSecret(cmd.supplierId);
    const ownerPk = deriveOwnerPublicKey(ownerSecret);

    // 실사용 시 국세청 승인번호에서 유도한다 (docs/ONCE_Finance_개발명세.md §2).
    const invoiceId = bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)));
    const salt = generateSalt();
    const leaf = computeInvoiceLeaf({ invoiceId, faceAmount: cmd.faceAmount, ownerPk });

    const issuanceId = randomUUID();
    await this.pending.put({
      id: issuanceId,
      supplierId: cmd.supplierId,
      invoiceId,
      faceAmount: cmd.faceAmount,
      salt,
      ownerPk,
      leaf,
      detail: cmd.detail,
      risk: cmd.risk,
      requestId: cmd.requestId ?? null,
      createdAt: new Date().toISOString(),
    });

    return {
      issuanceId,
      invoiceId,
      leaf,
      rootBefore: await this.reader.getIssuerRoot(),
    };
  }
}
