# 테스트 결과

`pnpm test` — **13개 파일, 48건 전부 통과** (2026-09-17 기준).

실행 환경은 `docs/VERSIONS.md`에 고정돼 있다.

---

## 1. 공격 시나리오

`test/attacks/`에 시나리오당 파일 하나. 전부 **회로 수준에서** 거부된다.
`packages/chain`의 시뮬레이터는 목 구현이 아니라 컴파일된 `once.compact`를
그대로 실행하므로, 아래 거부는 애플리케이션 계층이 아니라 회로의 assert가
만든 결과다.

| ID | 시나리오 | 기대 결과 | 실제 | 거부 지점 |
|---|---|---|---|---|
| A1 | 파일명·인코딩 변경 후 재신청 | nullifier 동일 → 거부 | ✅ | `assert(!usedNullifiers.member(nf))` |
| A2 | 새 salt로 재봉인해 신청 | commitment은 다르나 nullifier 동일 → 거부 | ✅ | 〃 |
| A3 | 액면금액 부풀려 한도 초과 신청 | Merkle 리프 불일치 → 거부 | ✅ | `assert(path.leaf == leaf)` |
| A4 | 타인 채권으로 신청 | 소유권 검증 실패 → 거부 | ✅ | 〃 |
| A5 | 두 금융사에 동시 신청 | 하나만 확정, 나머지 자금 보존 | ✅ | `assert(!usedNullifiers.member(nf))` |
| A6 | 미사용 시점 증명을 사용 후 제출 | 실행 시점 재검사로 거부 | ✅ | 〃 |
| A7 | 미등록 금융사로 신청 | 거부 | ✅ | `assert(registeredLenders.member(lender))` |
| A8 | 발급자 아닌 키로 권한 회로 호출 | 거부 | ✅ | `assert(issuerPublicKey(issuerSecret()) == issuerPk)` |
| A9 | 카나리아 전수 검색 | 어디에도 나타나지 않음 | ✅ | §3 참조 |

모든 거부 테스트는 **거부 후 `lenderVault` 잔액이 그대로인지**까지 확인한다.
자금이 나가지 않았다는 것이 제품의 주장이므로 숫자로 검증한다.

### A3와 A4가 같은 오류를 내는 이유

둘 다 `invoice leaf mismatch`로 떨어진다. 회로가 아는 것은 "이 채권이 발급
기관 집합에 없다"뿐이고, 금액을 부풀렸는지 타인 채권인지는 구분하지 않는다.

이건 한계가 아니라 의도다. 구분해서 알려주면 공격자가 어느 필드를 틀렸는지
알아내는 오라클이 된다. API도 둘 다 `ISSUER_ATTESTATION_FAILED`로 내보낸다.

### A5·A6가 왜 핵심인가

두 시나리오 모두 **사전 조회에서는 "미사용"을 본다.** 조회와 지급 사이의
틈이 기존 방식의 구멍이고, 이 제품이 블록체인을 쓰는 이유 그 자체다
(CONTEXT §4.3).

A5는 2건·5건 동시 신청에서 정확히 하나만 확정되고 총 지출이 한 건분임을
확인한다. A6은 미사용 시점에 준비한 요청이 사용 후에 거부되는 것을 확인한다.

---

## 2. 불변식

| 불변식 | 강제 방법 | 테스트 |
|---|---|---|
| INV-1 nullifier가 salt에 의존하지 않는다 | 회로·TS 양쪽에서 입력이 (태그, issuerId, invoiceId) 셋뿐 | `packages/crypto/test/invariants.spec.ts` |
| INV-2 commitment이 salt를 포함한다 | 입력 5개 중 salt 포함 | 〃 |
| INV-3 중복 검사와 지급이 한 트랜잭션 | `usedNullifiers.insert` 직후 `sendUnshielded` | A5, A6 |

`computeNullifier.length === 2`를 테스트로 고정했다. 나중에 누가 "편의를 위해"
salt나 금융사나 시각을 인자로 추가하면 여기서 깨진다.

### S1 라운드트립

회로와 TS의 해시가 일치하는지를 **컴파일러가 생성한 `pureCircuits`와 직접
대조**한다. 회로 소스가 바뀌면 이 테스트가 즉시 깨진다.

금액 경계값 `0`, `1`, `2^32`, `2^64-1`까지 일치를 확인했다.

---

## 3. A9 — 비공개성 검토

### 3.1 문자열 검색

채권 원문 전 필드(`counterparty`, `dueDate`, `approvalNumber`, `memo`)에
`CANARY_ONCE_7F3A`를 심고 아래를 전수 검색했다. 전부 미검출.

- 공개 원장 API (`GET /api/public/loans`)
- 납품업체 채권 목록 API (`GET /api/supplier/invoices`)
- SSE 이벤트 스트림
- 온체인 원장 스냅샷 전체
- 마스킹 인터셉터를 통과한 로그 출력
- 도메인 오류 메시지와 스택 트레이스

공개 원장 행의 키가 `PUBLIC_LOAN_FIELDS`와 정확히 일치하는지도 확인한다.
누가 편의를 위해 필드를 하나 추가하면 여기서 잡힌다.

### 3.2 `disclose()` 호출 지점 수동 검토

**문자열 미검출은 암호학적 비공개성의 증명이 아니다.** SPEC §10.2에 따라
`once.compact`의 `disclose()` 호출 19곳을 전수 검토했다.

| 공개되는 값 | 위치 | 판단 |
|---|---|---|
| `issuerId`, `issuerPk`, `ltvBps` | 생성자 | 공개 설정값 |
| `leaf` | `registerInvoice` | 해시. 원문 복원 불가 (§3.3 단서) |
| `lender` | 등록·예치·`finance` | 금융사 주소는 공개 (CONTEXT §5) |
| `amount` | 예치·`finance` | 대출 금액은 공개 (CONTEXT §5) |
| `merkleTreePathRoot(path)` | `finance` | 원장이 이미 아는 공개 루트와 비교될 뿐 |
| `nf` (nullifier) | `finance` | 공개가 목적인 값 |
| `cm` (commitment) | `finance` | 공개. 내용 추론 불가 |
| `recipient` | `finance` | 지급 대상 주소 |

**비공개 witness는 어느 `disclose()`에도 등장하지 않는다.** 확인한 값:
`inv.invoiceId`, `inv.faceAmount`, `inv.salt`, `ownerSecret()`, `issuerSecret()`.

컴파일러가 명시적 공개 분석을 강제하므로, witness에서 유도된 값을 원장 연산에
넘기면 `disclose()` 없이는 **컴파일이 실패한다.** 이 검토는 컴파일러가 이미
막아주는 것을 재확인한 것이고, 판단이 필요한 부분은 "공개해도 되는가"뿐이다.

### 3.3 인정하는 노출 — 문자열 검색이 잡지 못하는 것

두 가지를 기록해 둔다. 숨기면 심사에서 공격받는다.

**(1) 대출 금액에서 액면금액이 추론된다.**
`amount`는 공개고 `ltvBps`도 공개다. 납품업체가 한도를 꽉 채워 빌리면
`faceAmount = amount / LTV`가 그대로 드러난다. CONTEXT §6이 인정하는
"어느 금융사가 얼마를 취급했는지는 보인다"보다 한 걸음 더 나간 노출이다.
중복 감지 자체에는 필요 없는 정보이므로, 실제 제품이라면 금액을 범위로
공개하거나 숨기는 설계를 검토해야 한다. 데모에서는 하지 않았다.

**(2) 리프 해시는 추측 확인을 허용한다.**
`leaf = H(태그, invoiceId, faceAmount, ownerPk)`는 원문을 복원할 수 없지만,
세 값을 **추측한 사람은 맞았는지 확인할 수 있다.** 데모의 `invoiceId`는
32바이트 난수라 문제가 없다. 그러나 실사용 시 국세청 승인번호는 구조가 있고
엔트로피가 낮아, 거래처와 금액을 아는 사람이 후보를 좁힐 수 있다.
실제 제품이라면 리프에 발급 기관만 아는 비밀값을 섞어야 한다.

---

## 4. LSP — 공유 계약 테스트

`test/contract-tests/chain-gateway.spec.ts`는 재사용 가능한 스위트 함수다.
모든 `ChainGateway` 구현이 같은 계약을 지키는지 확인한다.

- 같은 입력에 같은 오류 타입을 던진다
- 중복 nullifier에 **어떤 구현이든** `NullifierAlreadyUsedError`를 던진다
- 공개 원장 행에 채권 원문 필드가 없다

현재는 `LocalCircuitChainGateway` 하나만 돌린다. G4에서
`MidnightChainGateway`를 추가하면 같은 스위트를 그대로 돌린다. 새 구현이
통과하지 못하면 유스케이스가 아니라 구현을 고친다.

---

## 5. 아직 검증하지 않은 것

정직하게 적는다.

- **테스트넷 배포와 실제 증명 생성** (G4). 로컬 실행은 회로 로직을 직접
  실행할 뿐, 노드가 수행하는 증명 트랜스크립트 검증을 대신하지 않는다.
  A5·A6의 주장은 "회로가 실행 시점 상태를 본다"이고 그건 로컬에서 증명되지만,
  전체 스택 확인은 남아 있다.
- **합의 계층의 트랜잭션 순서 결정.** 시뮬레이터는 제출 큐로 직렬화를
  모델링했다. 실제 블록 포함 규칙과 같지 않다.
- **E2E (Playwright).** 3화면 시나리오는 수동으로 확인했고 스크린샷으로
  기록했다. 자동화된 E2E는 작성하지 않았다.
