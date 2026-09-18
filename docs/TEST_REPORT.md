# 테스트 결과

`pnpm test`: **22개 파일, 110건 통과 · 1건 건너뜀** (2026-09-19 기준).
건너뛰는 1건은 실제 네트워크가 필요한 계약 테스트다 (§4).

빈 디렉터리에 새로 클론하고 pnpm 스토어까지 비운 상태에서도 같은 결과다
(README «클린 환경에서 확인했다»).

툴체인 0.31.1 / 런타임 0.16.0 / ledger 8.0.2 기준이다. 이 조합이 라이브
네트워크가 쓰는 버전이고, 최신 0.34로는 배포가 불가능하다 ([VERSIONS.md](VERSIONS.md)).

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

### 거부 테스트는 assert 단위로 확인한다

`.rejects.toThrow()`는 "거부됐다"만 보고 "왜 거부됐는지"는 보지 않는다.
실제로 그것 때문에 **A3·A4가 오랫동안 거짓 통과했다.** witness의 Merkle 경로
길이가 회로 깊이(10)와 달라서, 발급자 인증 검사에 **도달하기도 전에** 타입
오류로 죽고 있었는데 테스트는 초록불이었다.

그래서 모든 거부 테스트를 `expectCircuitReject(run, ASSERT.X)`로 바꿨다.
두 가지를 본다.

1. 기대한 회로 assert 메시지가 실제로 나왔는가
2. 타입 오류·witness 오류로 죽은 건 아닌가
   (거부는 됐지만 검증하려던 것을 검증하지 못한 경우)

가드가 실제로 동작하는지 버그를 일부러 되살려 확인했다. 재주입 상태에서
A3·A4가 "회로 assert에 도달하지 못했다"로 실패하고, 원복하면 통과한다.

A5는 거부 사유가 중복 nullifier인지까지 본다. 자금 부족으로 거부된 것이라면
동시 신청 방어를 검증한 게 아니다.

### 회로 assert 매핑 고정

화면 로그가 `거부 · assert: !usedNullifiers.member(nf) · NULLIFIER_ALREADY_USED`
처럼 회로 근거를 보여준다. 그 근거가 실제 회로와 어긋나지 않도록
`CIRCUIT_ASSERT` 맵을 `once.compact` 원문과 대조한다
(`test/contract-tests/circuit-assert-map.spec.ts`).

실제로 이 테스트가 내가 잘못 적은 표현식을 잡았다.
`amount * 10000 <= faceAmount * ltvBps` 로 적었는데 회로는 `inv.faceAmount`였다.

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

## 3. A9: 비공개성 검토

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

### 3.3 인정하는 노출: 문자열 검색이 잡지 못하는 것

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

## 4. LSP: 공유 계약 테스트

`test/contract-tests/chain-gateway.spec.ts`는 재사용 가능한 스위트 함수다.
모든 `ChainGateway` 구현이 같은 계약을 지키는지 확인한다.

- 같은 입력에 같은 오류 타입을 던진다
- 중복 nullifier에 **어떤 구현이든** `NullifierAlreadyUsedError`를 던진다
- 공개 원장 행에 채권 원문 필드가 없다

### 실제 체인에도 같은 스위트를 돌린다

스위트를 **읽기 계약과 쓰기 계약으로 나눴다.** 두 구현이 지키는 범위가
다르기 때문이다.

`chainReaderContract` 는 두 구현이 모두 지킨다. `MidnightChainGateway` 를
배포된 Preprod 컨트랙트에 붙여 같은 스위트를 돌렸고 통과한다
(`test/contract-tests/live-chain.spec.ts`, 19건). 네트워크가 필요하므로
옵트인이다 — 심사용 기본 경로에서는 건너뛴다:

```
ONCE_LIVE_CHAIN=1 CHAIN_MODE=preprod CONTRACT_ADDRESS=… DEPLOY_BLOCK=… \
  pnpm exec vitest run test/contract-tests/live-chain.spec.ts
```

`chainWriterContract` 는 `LocalCircuitChainGateway` 만 지킨다. **그게
정상이다.** 실제 네트워크에서 서버가 서명할 수 있다면 사용자 자산을 서버가
움직일 수 있다는 뜻이다. `MidnightChainGateway` 의 쓰기 세 경로는 한결같이
`ServerCannotSignError` 를 던지고, 그것 자체를 스위트가 확인한다.

리프 조회 검사에는 짝이 되는 반대 검사를 둔다 — 소유자 키가 다르면 같은
채권이라도 리프를 찾지 못해야 한다. 없으면 `hasInvoiceLeaf` 가 항상 true 를
돌려줘도 스위트가 통과한다.

---

## 5. 아직 검증하지 않은 것

정직하게 적는다.

- **A5·A6를 실제 네트워크에서 돌린 결과.** 배포는 끝났고 읽기 경로는 실제
  컨트랙트로 검증했지만, 이 두 시나리오는 **트랜잭션을 실제로 내야** 하고
  그 서명은 지갑만 할 수 있다. 사람이 승인 창을 눌러야 하므로 자동으로
  돌릴 수 없다.

  실행기는 만들어 두었다. `/console` 의 지갑 패널에 **실제 체인 공격 재현**
  섹션이 있고, A5·A6 각각 지갑 승인 2회로 끝난다. 판정은 통과·실패·판정
  불가 세 갈래이고, 지갑 문제로 죽은 것을 통과로 세지 않는다
  (`apps/web/src/shared/runtime/onchain-verdict.ts`).

  **헤드리스 경로(`apps/deploy/src/scenario.ts`)는 쓸 수 없다.** 그 지갑은
  DUST 등록이 돼 있지 않고, DUST 동기화만 세 시간 넘게 걸린다(측정: 분당
  약 5,200 블록, 남은 108만 블록). 등록을 마쳐도 브라우저 경로와 같은
  일을 더 느리게 하는 것이라 우선순위를 뒤로 뒀다.

  로컬 실행은 회로 로직을 직접 실행할 뿐, 노드가 수행하는 증명 트랜스크립트
  검증을 대신하지 않는다. A5·A6의 주장인 "회로가 실행 시점 상태를 본다" 는
  로컬에서 증명되지만, 전체 스택 확인은 위 실행기를 눌러야 닫힌다.
- **합의 계층의 트랜잭션 순서 결정.** 시뮬레이터는 제출 큐로 직렬화를
  모델링했다. 실제 블록 포함 규칙과 같지 않다.
- **E2E (Playwright).** 3화면 시나리오는 수동으로 확인했고 스크린샷으로
  기록했다. 자동화된 E2E는 작성하지 않았다.
