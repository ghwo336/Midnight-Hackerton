# ONCE Finance — 개발 명세

**에이전트 핸드오프 문서.** 이 문서 하나로 구현이 가능해야 한다.
스택: Next.js (web) · NestJS (api) · Compact (contracts) · TypeScript 전면

---

## 0. 에이전트 작업 규칙

이 절은 코드를 쓰기 전에 반드시 읽는다.

### 0.1 절대 규칙

1. **Compact 문법을 기억으로 쓰지 않는다.** 학습 데이터가 거의 없고 버전마다 문법이 바뀐다. 이 문서의 Compact 코드는 전부 **의사코드**다. 실제 작성 전에 반드시:
   - Midnight Expert 플러그인(Claude Code용)을 설치하고 로드한다. 이게 1순위다.
   - `midnight-awesome-dapps` 레포와 공식 Docs 레포를 클론해 컨텍스트에 넣는다.
   - 유사 패턴(commitment / nullifier / Merkle membership)을 쓰는 예제를 먼저 읽고 그 구조를 따른다.
   - 컴파일이 실패하면 추론으로 고치지 말고 예제와 대조한다.

2. **§2의 스파이크를 통과하기 전에 본 구현을 시작하지 않는다.** 스파이크 결과에 따라 아키텍처가 갈린다.

3. **금액은 `bigint` 또는 정수 최소단위만 사용한다.** `number`로 금액을 다루면 안 된다. 부동소수점 연산 금지.

4. **`any` 금지.** `tsconfig`는 `strict: true`, `noUncheckedIndexedAccess: true`. 타입을 모르겠으면 `unknown` 후 좁힌다.

5. **비밀값을 로그·응답·에러 메시지에 절대 넣지 않는다.** 채권 원문, salt, 비밀키, Merkle 경로가 여기 해당한다. 에러는 코드와 안전한 메시지만 반환한다.

6. **막히면 §12 축소 순서를 따른다.** 새 기능을 추가해서 우회하지 않는다.

### 0.2 판단이 필요하면 멈추고 보고한다

- 스파이크 결과가 이 문서의 가정과 다를 때
- Compact가 필요한 기능(원자적 자금 이동, 회로 내 해시 등)을 지원하지 않을 때
- 아키텍처 경계(§4)를 깨야 구현이 되는 상황일 때

임의로 설계를 바꾸지 말고 무엇이 왜 안 되는지 보고한다.

---

## 1. 도메인 용어

코드 식별자는 영어, 주석·UI는 한국어. 매핑을 고정한다.

| 한국어 | 식별자 | 정의 |
|---|---|---|
| 매출채권 | `Invoice` | 납품 후 받을 돈에 대한 권리. 담보의 대상 |
| 채권 고유번호 | `invoiceId` | 발급 기관이 부여. 복사·재발급해도 불변. 실사용 시 국세청 승인번호 |
| 액면금액 | `faceAmount` | 채권의 원금. `bigint` |
| 발급 기관 | `Issuer` | 유효 채권 집합을 인증. 데모에서는 목업 1곳 |
| 발급자 루트 | `issuerRoot` | 유효 채권 리프들의 Merkle 루트. 온체인 공개 |
| 납품업체 | `Supplier` | 채권 보유자이자 대출 신청자 |
| 금융사 | `Lender` | 대출 실행 주체. 데모에서는 A, B 두 곳 |
| 봉인값 | `commitment` | 채권 내용을 숨기면서 고정. salt 포함 |
| 중복 확인값 | `nullifier` | 같은 채권이면 항상 같은 값. salt 무관 |
| 대출 실행 | `financing` | 중복 확인값 등록 + 자금 지급. **원자적** |
| 담보 한도 | `LTV_BPS` | 액면금액 대비 대출 가능 비율. basis point 정수 |

### 1.1 핵심 불변식

이 세 가지가 깨지면 제품이 아니다. 테스트로 강제한다.

```
INV-1  nullifier = H(DOMAIN_TAG, issuerId, invoiceId)
       → salt, 금융사, 시각, 신청자, 파일명에 의존하지 않는다

INV-2  commitment = H(invoiceId, faceAmount, ownerPk, salt)
       → salt를 포함한다. salt는 채권마다 유일하며 재사용하지 않는다

INV-3  nullifier 미사용 검사와 자금 지급은 같은 트랜잭션에서 일어난다
       → 조회 후 별도 지급은 구현으로 인정하지 않는다
```

`nullifier`와 `commitment`의 입력이 다르다는 점이 설계의 핵심이다. 같은 채권을 salt만 바꿔 다시 봉인해도 `nullifier`가 같아서 거부된다.

---

## 2. 스파이크 — 본 구현 전 필수 검증

각 스파이크는 최소 코드로 사실만 확인한다. 결과를 `docs/SPIKE.md`에 기록한다.

| ID | 질문 | 확인 방법 | 결과에 따른 분기 |
|---|---|---|---|
| **S1** | 회로 안에서 쓸 수 있는 해시 함수는 무엇이고, 같은 함수의 TS 구현이 있는가 | 회로에서 해시 1회 + TS에서 같은 입력 해시 → 값 일치 확인 | 불일치하면 모든 증명이 실패한다. 여기서 막히면 진행 불가 |
| **S2** | 컨트랙트가 토큰을 보관하고 회로 실행과 같은 트랜잭션에서 지급할 수 있는가 | 최소 컨트랙트로 입금 → 조건부 출금 | 불가 시 → **폴백 A** (§2.1) |
| **S3** | 회로 안에서 Merkle 멤버십 검증이 가능하고 비용이 감당되는가 | 깊이 8 트리로 멤버십 증명 1건, 증명 생성 시간 측정 | 불가 시 → **폴백 B** (§2.1) |
| **S4** | 같은 nullifier로 두 트랜잭션이 동시에 들어오면 하나만 성공하는가 | 두 트랜잭션을 거의 동시에 제출 | 둘 다 성공하면 설계 재검토. 제품의 핵심 주장이 무너진다 |
| **S5** | 백엔드(브라우저 지갑 아님)에서 증명 생성·트랜잭션 제출이 가능한가 | Node 프로세스에서 증명 → 제출 | 불가 시 → **폴백 C** (§2.1) |

### 2.1 폴백

- **폴백 A** (자금 이동 불가): 지급을 온체인 `LoanReceipt` 기록으로 낮추고, 실제 자금 이동은 금융사 시스템 몫으로 선언한다. 원자성 주장은 "중복 확인값 등록과 대출 승인 기록이 원자적"으로 축소한다. 데모 문구도 함께 수정한다.
- **폴백 B** (Merkle 불가): 발급자가 채권별 서명을 발행하고 회로에서 서명 검증. 그것도 불가하면 발급자가 `invoiceId` 해시 목록을 온체인 Set으로 올리고 회로는 멤버십 대신 **공개 Set 조회**로 대체한다(프라이버시가 약해지므로 한계로 명시).
- **폴백 C** (백엔드 제출 불가): 브라우저 + Lace 지갑 구조로 전환. 이 경우 §5의 역할별 세션 모델을 브라우저 프로필 3개로 바꾸고, 데모는 창 3개를 띄운다.

---

## 3. 시스템 구조

```
┌──────────────────────────────────────────────────────┐
│  apps/web  (Next.js)                                 │
│  납품업체 화면 · 금융사 A 화면 · 금융사 B 화면        │
│  얇은 뷰. 도메인 로직 없음. SSE로 실시간 갱신          │
└───────────────────────┬──────────────────────────────┘
                        │ REST + SSE
┌───────────────────────▼──────────────────────────────┐
│  apps/api  (NestJS)                                   │
│  ┌────────────────────────────────────────────────┐  │
│  │ interface   컨트롤러 · DTO · SSE                │  │
│  ├────────────────────────────────────────────────┤  │
│  │ application 유스케이스 · 포트(인터페이스)        │  │
│  ├────────────────────────────────────────────────┤  │
│  │ infrastructure  Midnight 어댑터 · 증명 · 저장소  │  │
│  └────────────────────────────────────────────────┘  │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│  contracts  (Compact)                                 │
│  issuerRoot · usedNullifiers · loans · finance 회로    │
└──────────────────────────────────────────────────────┘
```

### 3.1 데모 단순화 (명시적으로 선언할 것)

실제 제품에서 채권 원문과 비밀키는 **납품업체 본인의 기기**에 있어야 한다. 이 구현에서는 데모 편의를 위해 NestJS가 역할별로 분리된 저장소에 보관한다.

- 역할별 저장소는 **논리적으로 완전히 분리**한다. 금융사 세션이 납품업체의 원문에 접근하는 경로가 코드에 존재해서는 안 된다.
- README와 발표에 이 단순화를 명시한다. 숨기면 심사에서 공격받는다.
- `PrivateStateRepository` 인터페이스 뒤에 두어, 나중에 브라우저 저장소로 교체 가능하게 한다.

---

## 4. 레포 구조와 의존 규칙

```
once/
├── contracts/
│   ├── src/once.compact
│   ├── test/
│   └── README.md                  # 컴파일러 버전, 빌드 방법
├── packages/
│   ├── domain/                    # 의존성 0. 순수 타입 + 규칙
│   │   └── src/{invoice,loan,errors,invariants}.ts
│   ├── crypto/                    # 해시·commitment·nullifier·merkle (TS)
│   │   └── src/{hash,commitment,nullifier,merkle}.ts
│   └── chain/                     # Midnight SDK 래퍼
│       └── src/{client,contract,types}.ts
├── apps/
│   ├── api/                       # NestJS
│   └── web/                       # Next.js
├── test/
│   └── attacks/                   # §10 공격 시나리오
└── docs/
    ├── SPIKE.md
    ├── VERSIONS.md                # 컴파일러·SDK·노드·지갑 버전 고정
    └── TEST_REPORT.md
```

### 4.1 의존 방향 (강제)

```
web  →  (HTTP)  →  api
api  →  application  →  domain
api  →  infrastructure  →  chain  →  Midnight SDK
domain  →  아무것도 의존하지 않음
crypto  →  domain 만
```

**금지 사항**
- `domain`이 NestJS, Midnight SDK, Next.js를 import하는 것
- `application`이 `infrastructure`의 구체 클래스를 import하는 것 (포트 인터페이스만)
- `web`이 `chain` 또는 Midnight SDK를 직접 import하는 것

ESLint `no-restricted-imports`로 강제한다. 규칙을 우회해야 구현이 되면 설계가 틀린 것이므로 보고한다.

---

## 5. SOLID 적용 — 구체적으로

원칙 나열이 아니라 이 프로젝트에서 어디에 어떻게 적용하는지를 고정한다.

### SRP — 단일 책임

각 클래스는 바꿔야 할 이유가 하나여야 한다.

```ts
// 나쁨: 계산 + 상태확인 + 제출이 한 곳에
class FinancingService {
  async finance() { /* nullifier 계산, 체인 조회, 증명 생성, 제출, 알림 */ }
}

// 좋음: 책임 분리
class NullifierCalculator {}        // 계산만. 순수 함수. 체인 모름
class FinancingUseCase {}           // 흐름 조율만. 계산·제출 방법 모름
class MidnightChainGateway {}       // 제출만. 왜 제출하는지 모름
class ProofGenerator {}             // 증명 생성만
```

### OCP — 확장에는 열림, 수정에는 닫힘

스파이크 결과에 따라 발급자 검증 방식이 바뀔 수 있다(§2.1 폴백 B). 전략으로 분리한다.

```ts
export interface IssuerVerificationStrategy {
  readonly kind: 'merkle' | 'signature' | 'public-set';
  buildWitness(invoice: PrivateInvoice): Promise<IssuerWitness>;
}
```

구현을 갈아끼워도 `FinancingUseCase`는 수정하지 않는다.

### LSP — 치환 가능

`ChainGateway`의 모든 구현(`MidnightChainGateway`, `InMemoryChainGateway`)은 동일한 계약을 지킨다. 목 구현이 실제와 다르게 동작하면 테스트가 거짓말을 한다.

- 같은 입력에 같은 오류 타입을 던진다
- 중복 nullifier에 대해 둘 다 `NullifierAlreadyUsedError`를 던진다
- **공유 계약 테스트**를 작성해 두 구현에 동일하게 돌린다 (`test/contract-tests/chain-gateway.spec.ts`)

### ISP — 인터페이스 분리

읽기와 쓰기를 나눈다. 조회만 하는 곳이 지급 메서드에 접근하면 안 된다.

```ts
export interface ChainReader {
  getIssuerRoot(): Promise<Hex>;
  isNullifierUsed(n: Hex): Promise<boolean>;
  listLoans(): Promise<LoanRecord[]>;
}

export interface ChainWriter {
  submitFinancing(tx: FinancingTx): Promise<TxResult>;
  updateIssuerRoot(root: Hex): Promise<TxResult>;  // 발급자 전용
}
```

대시보드 유스케이스는 `ChainReader`만 주입받는다.

### DIP — 의존 역전

유스케이스는 인터페이스에만 의존하고, 구현은 모듈에서 바인딩한다.

```ts
// application/ports/chain.gateway.ts
export const CHAIN_READER = Symbol('CHAIN_READER');
export const CHAIN_WRITER = Symbol('CHAIN_WRITER');

// infrastructure/midnight/midnight.module.ts
@Module({
  providers: [
    { provide: CHAIN_READER, useClass: MidnightChainGateway },
    { provide: CHAIN_WRITER, useClass: MidnightChainGateway },
  ],
  exports: [CHAIN_READER, CHAIN_WRITER],
})
export class MidnightModule {}
```

이 구조 덕분에 회로가 완성되기 전에도 목 어댑터로 전체 흐름을 개발할 수 있다(§11 G2).

---

## 6. 컨트랙트 (Compact)

> 아래는 전부 의사코드다. §0.1에 따라 실제 문법을 확인하고 작성한다.

### 6.1 상태

```
ledger {
  issuerRoot:      Field                        // 발급자가 등록한 유효 채권 Merkle 루트
  issuerPk:        PublicKey                    // 루트 갱신 권한
  registeredLender: Set<Field>                  // 등록된 금융사
  usedNullifiers:  Set<Field>                   // 사용된 중복 확인값
  loans:           Map<Field, LoanRecord>       // nullifier → 대출 기록
  vault:           TokenBalance                 // 폴백 A면 제거
}

LoanRecord { lender: Field, amount: Uint64, commitment: Field, block: Uint64 }
```

### 6.2 회로 `finance`

```
export circuit finance(
  lender: Field,            // public
  amount: Uint64,           // public
): [] {
  // ── witness (비공개) ──
  const inv = witness_invoice();    // { id, faceAmount, ownerPk, salt, merklePath }
  const sk  = witness_ownerSecret();

  // 1. 발급 기관이 인증한 채권인가
  const leaf = hash(inv.id, inv.faceAmount, inv.ownerPk);
  assert(merkleVerify(leaf, inv.merklePath, ledger.issuerRoot));

  // 2. 신청자가 소유자인가
  assert(derivePublicKey(sk) == inv.ownerPk);

  // 3. 요청 금액이 담보 한도 이내인가  (정수 연산만)
  assert(amount * 10000 <= inv.faceAmount * LTV_BPS);

  // 4. 중복 확인값 — salt에 의존하지 않는다 (INV-1)
  const nf = hash(DOMAIN_TAG_NULLIFIER, ledger.issuerPk, inv.id);

  // 5. 봉인값 — salt를 포함한다 (INV-2)
  const cm = hash(inv.id, inv.faceAmount, inv.ownerPk, inv.salt);

  // ── 공개 상태 변경: 실행 시점에 재확인한다 (INV-3) ──
  assert(ledger.registeredLender.member(lender));
  assert(!ledger.usedNullifiers.member(nf));      // ★ 증명 시점이 아니라 실행 시점

  ledger.usedNullifiers.insert(nf);
  ledger.loans.insert(nf, LoanRecord { lender, amount, commitment: cm, block: now() });

  transferFrom(ledger.vault, lender_account_of(lender), amount);   // 폴백 A면 제거

  disclose(nf);
  disclose(cm);
}
```

**가장 중요한 줄은 `assert(!ledger.usedNullifiers.member(nf))`다.** 이것이 실행 시점의 공개 상태 검사로 들어가야 한다. 증명 생성 시점에만 확인하면, 증명을 미리 만들어 두었다가 나중에 제출하는 공격이 통한다(§10 A6).

### 6.3 보조 회로

```
export circuit updateIssuerRoot(newRoot: Field): []
  // issuerPk 서명자만. 이전 루트는 이벤트로 남긴다

export circuit registerLender(lender: Field): []
  // 데모용. 운영자 권한
```

### 6.4 금지

- 업그레이더블 프록시 패턴 — 같은 주소에서 코드 교체가 가능하면 제품의 전제가 무너진다
- `disclose()`를 회로 상단에서 호출하는 것 — 공개 상태로 나가는 지점에서만
- 채권 원문·salt·비밀키를 public input으로 받는 것

---

## 7. `packages/crypto`

회로와 **완전히 동일한** 해시를 TS로 구현한다. S1에서 확인한 함수를 쓴다.

```ts
export const DOMAIN_TAG_NULLIFIER = '0x4f4e43452f6e66'; // "ONCE/nf"

export function computeNullifier(issuerPk: Hex, invoiceId: Hex): Hex;
export function computeCommitment(i: {
  invoiceId: Hex; faceAmount: bigint; ownerPk: Hex; salt: Hex;
}): Hex;

export function buildMerkleTree(leaves: Hex[]): MerkleTree;
export function merkleProof(tree: MerkleTree, index: number): Hex[];
```

### 7.1 필수 테스트: 라운드트립

회로와 TS가 같은 값을 내는지 검증하는 테스트를 **가장 먼저** 만든다. 이게 깨지면 나머지 전부가 조용히 실패한다.

```ts
it('회로와 TS의 해시가 일치한다', async () => {
  const tsValue = computeNullifier(ISSUER_PK, INVOICE_ID);
  const circuitValue = await runCircuitHashOnly(ISSUER_PK, INVOICE_ID);
  expect(tsValue).toBe(circuitValue);
});
```

### 7.2 salt 생성

```ts
export function generateSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
```

salt 재사용은 금지다. 발급 시 채권마다 새로 만들고, 저장소에 유일성 제약을 건다.

---

## 8. 백엔드 (NestJS)

### 8.1 모듈 구조

```
apps/api/src/
├── main.ts
├── app.module.ts
├── config/                       # 환경변수 스키마 검증 (zod)
├── application/
│   ├── ports/
│   │   ├── chain.gateway.ts      # ChainReader / ChainWriter
│   │   ├── prover.port.ts
│   │   ├── private-state.repository.ts
│   │   └── issuer-verification.strategy.ts
│   ├── issue-invoice.usecase.ts
│   ├── request-financing.usecase.ts
│   ├── cancel-invoice.usecase.ts
│   ├── list-loans.usecase.ts
│   └── list-invoices.usecase.ts
├── infrastructure/
│   ├── midnight/                 # ChainGateway 실제 구현
│   ├── proof/                    # ProofGenerator (proof server 호출)
│   ├── persistence/              # PrivateStateRepository (sqlite 또는 파일)
│   └── mock/                     # 모든 포트의 목 구현
├── interface/
│   ├── http/
│   │   ├── issuer.controller.ts
│   │   ├── supplier.controller.ts
│   │   ├── lender.controller.ts
│   │   ├── public.controller.ts  # 대시보드용 읽기 전용
│   │   └── dto/
│   └── events/
│       └── events.gateway.ts     # SSE
└── common/
    ├── errors/                   # 도메인 오류 → HTTP 매핑
    └── logging/                  # 비밀값 마스킹 인터셉터
```

### 8.2 유스케이스 작성 규칙

유스케이스는 **흐름만** 조율한다. 계산도 제출도 직접 하지 않는다.

```ts
@Injectable()
export class RequestFinancingUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
    @Inject(PROVER) private readonly prover: Prover,
    @Inject(ISSUER_STRATEGY) private readonly issuer: IssuerVerificationStrategy,
  ) {}

  async execute(cmd: RequestFinancingCommand): Promise<FinancingResult> {
    const invoice = await this.privateState.findInvoice(cmd.supplierId, cmd.invoiceId);
    if (!invoice) throw new InvoiceNotFoundError();

    // 사전 검사 — 사용자 경험용일 뿐, 보안 경계가 아니다.
    // 실제 방어는 컨트랙트의 실행 시점 검사다 (INV-3).
    const nullifier = computeNullifier(cmd.issuerPk, invoice.invoiceId);
    if (await this.reader.isNullifierUsed(nullifier)) {
      throw new NullifierAlreadyUsedError();
    }

    const witness = await this.issuer.buildWitness(invoice);
    const proof = await this.prover.prove('finance', {
      publicInputs: { lender: cmd.lenderId, amount: cmd.amount },
      witness: { ...witness, ownerSecret: invoice.ownerSecret },
    });

    return this.writer.submitFinancing({ proof, lender: cmd.lenderId, amount: cmd.amount });
  }
}
```

**사전 검사에 주석을 반드시 남긴다.** 이 검사가 보안 경계라고 착각하면 나중에 누군가 컨트랙트 쪽 검사를 "중복"이라며 지운다.

### 8.3 오류 처리

도메인 오류를 타입으로 정의하고 HTTP로 매핑한다. 절대 원인 문자열에 비밀값을 넣지 않는다.

```ts
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) { super(message); }
}

export const ERROR_HTTP_MAP: Record<DomainErrorCode, number> = {
  INVOICE_NOT_FOUND:        404,
  NULLIFIER_ALREADY_USED:   409,   // ★ 데모의 핵심 응답
  AMOUNT_EXCEEDS_LTV:       422,
  OWNERSHIP_VERIFY_FAILED:  403,
  LENDER_NOT_REGISTERED:    403,
  PROOF_GENERATION_FAILED:  500,
  CHAIN_SUBMIT_FAILED:      502,
};
```

`409 NULLIFIER_ALREADY_USED`가 데모에서 가장 중요한 응답이다. 프론트는 이 코드로 "중복 담보 · 지급 거부" 화면을 띄운다.

### 8.4 SSE

3개 화면이 동시에 갱신돼야 데모가 산다. 대출이 확정되면 모든 화면에 이벤트를 보낸다.

```ts
// GET /events/stream  (text/event-stream)
type OnceEvent =
  | { type: 'invoice.issued';   invoiceId: string }
  | { type: 'financing.settled'; nullifier: string; lender: string; amount: string; txHash: string }
  | { type: 'financing.rejected'; reason: DomainErrorCode; lender: string };
```

이벤트 페이로드에 채권 원문·금액 외 민감 정보를 넣지 않는다. 공개 원장에 올라가는 것과 같은 수준만 내보낸다.

### 8.5 검증

컨트롤러 입력은 `ZodValidationPipe`로 전량 검증한다. 금액은 문자열로 받아 `bigint`로 변환한다.

```ts
export const RequestFinancingSchema = z.object({
  invoiceId: z.string().regex(/^0x[0-9a-f]{64}$/),
  lenderId:  z.enum(['lender-a', 'lender-b']),
  amount:    z.string().regex(/^\d+$/).transform(BigInt),
});
```

### 8.6 로깅

비밀값 마스킹 인터셉터를 전역에 건다. 다음 키는 로그에 절대 나오지 않는다.

```
salt, ownerSecret, merklePath, faceAmount, counterparty, invoiceRaw
```

이걸 인터셉터로 강제하고, §10 A9 테스트로 검증한다.

---

## 9. 프론트엔드 (Next.js)

### 9.1 구조

```
apps/web/src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # 데모 콘솔: 3분할 화면
│   ├── supplier/page.tsx
│   ├── lender/[lenderId]/page.tsx
│   ├── issuer/page.tsx
│   └── ledger/page.tsx           # 공개 원장 뷰
├── features/
│   ├── invoice-list/
│   ├── financing-request/
│   ├── loan-ledger/
│   └── attack-panel/             # 공격 시나리오 실행 버튼
├── entities/
│   ├── invoice/                  # 표시 컴포넌트 + 타입
│   └── loan/
└── shared/
    ├── api/                      # 백엔드 클라이언트. 타입은 api에서 생성
    ├── sse/                      # useOnceEvents()
    └── ui/
```

### 9.2 규칙

- **서버 컴포넌트 기본.** 상호작용이 필요한 곳만 `'use client'`.
- **도메인 로직 금지.** nullifier 계산, 한도 검증을 프론트에서 하지 않는다. 백엔드 응답을 표시만 한다.
- **Midnight SDK를 직접 import하지 않는다.** 모든 체인 접근은 api 경유.
- 데이터는 TanStack Query. SSE 이벤트 수신 시 관련 쿼리를 무효화한다.
- 금액은 문자열로 받아 `Intl.NumberFormat`으로 표시. 프론트에서 금액 산술 금지.

### 9.3 데모 콘솔 (`/`)

이 화면이 발표의 얼굴이다. 3분할 고정.

```
┌─────────────┬─────────────┬─────────────┐
│  납품업체    │  금융사 A    │  금융사 B    │
│             │             │             │
│ 보유 채권 3  │ 대출 신청   │ 대출 신청    │
│ [A에 신청]  │  대기 중    │  대기 중     │
│ [B에 신청]  │             │             │
├─────────────┴─────────────┴─────────────┤
│  공개 원장 — 이 화면에 채권 내용은 없다   │
│  nullifier · 금융사 · 금액 · tx          │
├──────────────────────────────────────────┤
│  공격 패널  [A1] [A2] [A3] [A4] [A5]     │
└──────────────────────────────────────────┘
```

- 성공: 금융사 카드에 **지급 완료** + 금액 + tx 해시
- 거부: **중복 담보 · 지급 거부** + 사유 코드. 자금이 나가지 않았음을 금액 0으로 명시
- 공개 원장 패널에는 채권 원문 필드를 렌더링하는 코드가 **존재하지 않아야** 한다. 발표에서 이 점을 짚는다.

### 9.4 공격 패널

§10의 시나리오를 버튼으로 실행하고 결과를 그 자리에 표시한다. 발표 때 라이브로 누르는 버튼이므로 실패해도 화면이 깨지지 않게 오류를 정상 경로로 처리한다.

---

## 10. 테스트

### 10.1 계층별

| 대상 | 도구 | 범위 |
|---|---|---|
| `domain`, `crypto` | Vitest | 순수 함수. 불변식 INV-1/2 |
| 회로 | Compact 테스트 러너 | 정상 / 각 assert 실패 경로 |
| 유스케이스 | Vitest + 목 어댑터 | 흐름, 오류 매핑 |
| `ChainGateway` | 공유 계약 테스트 | 실제 구현과 목이 동일 동작 |
| E2E | Playwright | 3화면 시나리오 |

### 10.2 공격 시나리오

`test/attacks/`에 파일 하나씩. 결과를 `docs/TEST_REPORT.md`에 표로 기록한다. 발표 근거다.

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| A1 | 같은 채권 증빙의 파일명·인코딩 변경 후 재신청 | nullifier 동일 → 거부 |
| A2 | 새 salt로 다시 봉인해 다른 담보처럼 신청 | commitment는 다르나 nullifier 동일 → 거부 |
| A3 | 액면금액을 부풀려 한도 초과 신청 | Merkle 리프 불일치 → 증명 실패 |
| A4 | 다른 소유자의 채권으로 신청 | 소유권 검증 실패 |
| A5 | 두 금융사에 동시 신청 | 하나만 확정, 다른 쪽 자금 보존 |
| A6 | 미사용 시점에 만든 증명을 사용 후에 제출 | 실행 시점 재검사로 거부 (INV-3) |
| A7 | 미등록 금융사로 신청 | 거부 |
| A8 | 발급자 아닌 키로 `issuerRoot` 갱신 시도 | 거부 |
| A9 | 채권 원문에 `CANARY_ONCE_7F3A` 삽입 후 공개 데이터·로그·SSE·인덱서 전수 검색 | 어디에도 나타나지 않음 |

A6가 이 제품의 보안 주장 그 자체이므로 반드시 통과해야 한다. A9는 문자열 미검출이 암호학적 비공개성의 증명은 아니므로, 공개 필드 목록과 `disclose()` 호출 지점을 수동 검토한 결과도 함께 기록한다.

---

## 11. 구현 순서 (게이트)

각 게이트의 통과 기준을 만족하기 전에 다음으로 넘어가지 않는다.

**G0 — 환경**
Midnight Expert 로드, 예제 컨트랙트 컴파일·배포·호출 성공, `docs/VERSIONS.md` 작성.
→ *통과: 테스트넷에 트랜잭션 1건 확정*

**G1 — 스파이크**
S1~S5 수행, `docs/SPIKE.md` 작성, 폴백 결정.
→ *통과: S1 라운드트립 일치. 여기서 막히면 진행 불가*

**G2 — 도메인 + 목**
`packages/domain`, `packages/crypto`, 포트 인터페이스, 목 어댑터, 유스케이스, 컨트롤러.
→ *통과: 목 위에서 발급 → 신청 → 중복 거부 흐름이 통합 테스트로 통과*

**G3 — 회로**
`finance` 회로 구현, 실패 경로 테스트.
→ *통과: 정상 증명 성공, A3·A4에 해당하는 증명 실패 확인*

**G4 — 체인 연동**
`MidnightChainGateway` 구현, 목을 실제로 교체. 유스케이스 코드는 수정하지 않는다.
→ *통과: 테스트넷에서 같은 채권 두 번째 신청이 거부됨. A5·A6 통과*

**G5 — 프론트**
3화면 + 공개 원장 + 공격 패널, SSE 연결.
→ *통과: 사람이 클릭해서 데모 시나리오 완주*

**G6 — 검증**
공격 테스트 전량 실행, `TEST_REPORT.md`, README.
→ *통과: A1~A9 전부 기대 결과*

**G7 — 제출 패키지**
테스트넷 배포 주소·tx 기록, 데모 영상 녹화, 발표 자료.

---

## 12. 축소 순서

시간이 모자라면 위에서부터 자른다.

1. 채권 취소(`cancelInvoice`) 기능
2. 공개 원장 화면 — 데모 콘솔 하단 패널로 통합
3. 발급자 화면 — CLI 스크립트로 대체
4. 금융사 B 화면 — 같은 컴포넌트에 파라미터만 다르게
5. Merkle 깊이 축소 (8 → 4)
6. SSE → 폴링

**절대 자르지 않는 것**
- 실행 시점 nullifier 재검사 (INV-3)
- nullifier가 salt에 의존하지 않는 것 (INV-1)
- A5(동시 신청), A6(지연 제출) 테스트
- 공개 원장에 채권 원문이 없다는 사실

---

## 13. 함정

에이전트가 자주 틀리는 지점.

- **해시 불일치**: 회로와 TS가 다른 해시를 쓰면 모든 증명이 실패하는데 원인 추적이 어렵다. G1의 라운드트립 테스트를 먼저 만든다.
- **nullifier에 salt를 섞는 것**: 가장 흔한 실수다. 그러면 같은 채권을 salt만 바꿔 무한히 재사용할 수 있다. INV-1 테스트로 강제한다.
- **사전 조회를 방어로 착각**: `isNullifierUsed()` 조회 후 제출하는 것은 UX용이다. 컨트랙트 안의 실행 시점 검사가 없으면 A5·A6가 둘 다 뚫린다.
- **`disclose()` 위치**: 회로 상단에서 호출하면 의도치 않게 값이 공개된다. 공개 상태로 나가는 지점에서만.
- **금액을 `number`로**: 금융 도메인에서 부동소수점은 버그다. `bigint` 고정.
- **에러 메시지에 원문 포함**: `throw new Error(\`invoice ${JSON.stringify(invoice)} not found\`)` 같은 코드가 들어가면 A9가 실패한다.
- **프론트에서 도메인 계산**: nullifier를 프론트에서 계산하면 비밀값이 브라우저로 나간다.
- **목 구현이 실제와 다른 오류**: LSP 위반. 공유 계약 테스트로 막는다.
- **프록시 업그레이드 패턴 도입**: 제품의 전제를 무너뜨린다.

---

## 14. 환경 변수

```
# api
MIDNIGHT_NODE_URL=
MIDNIGHT_INDEXER_URL=
PROOF_SERVER_URL=
CONTRACT_ADDRESS=
ISSUER_SECRET_KEY=          # 데모용. 절대 커밋 금지
LTV_BPS=8000                # 80%
PRIVATE_STATE_PATH=./.data

# web
NEXT_PUBLIC_API_URL=
```

`.env.example`을 커밋하고 실제 `.env`는 `.gitignore`. `ISSUER_SECRET_KEY`가 레포에 들어가면 심사에서 감점 사유다.

---

## 15. README에 반드시 들어갈 것

심사위원이 코드보다 먼저 본다.

1. 한 문장 요약과 문제 정의
2. 왜 블록체인이고 왜 Midnight인가
3. **공개되는 것 / 공개되지 않는 것** 표
4. 보장 범위와 한계 — 특히 데모 단순화(§3.1)와 발급 기관 신뢰 가정
5. 배포된 컨트랙트 주소와 대표 tx 해시
6. 재현 절차 (`docs/VERSIONS.md` 참조)
7. 공격 테스트 결과표 (`docs/TEST_REPORT.md` 요약)
