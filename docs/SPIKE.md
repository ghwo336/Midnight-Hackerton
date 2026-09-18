# 스파이크 결과

SPEC §2의 다섯 가지를 본 구현 전에 확인했다. **폴백 A·B·C 모두 불필요하다.**

S6은 그 뒤에 추가한 것이다. "심사위원에게 보여주는 데모"에서 "모르는 사람이
접속해서 자기 지갑으로 쓰는 것"으로 방향을 바꿀 수 있는지를 본다.

| ID | 질문 | 결과 | 분기 |
|---|---|---|---|
| S1 | 회로와 TS가 같은 해시를 쓸 수 있는가 | ✅ 일치 | 진행 |
| S2 | 컨트랙트가 토큰을 보관하고 같은 트랜잭션에서 지급할 수 있는가 | ✅ 가능 | 폴백 A 불필요 |
| S3 | 회로 안에서 Merkle 멤버십 검증이 가능한가 | ✅ 가능 | 폴백 B 불필요 |
| S4 | 같은 nullifier로 두 트랜잭션이 오면 하나만 성공하는가 | ✅ 하나만 | 진행 |
| S5 | 백엔드에서 증명 생성·제출이 가능한가 | ⚠️ 부분 확인 | §S5 참조 |
| S6 | 사용자가 자기 브라우저 지갑으로 서명할 수 있는가 | ✅ 확인 (배포 완료) | §S6 참조 |

---

## S1: 해시 일치

**질문**: 회로 안에서 쓸 수 있는 해시 함수는 무엇이고, 같은 함수의 TS 구현이 있는가.

**결과**: Compact의 `persistentHash<T>(value): Bytes<32>`가 빌트인으로 있고,
`@midnight-ntwrk/compact-runtime`이 **같은 함수를 TS로 노출**한다.

```
회로:  persistentHash<Vector<3, Bytes<32>>>([a, b, c])
TS:    persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [a, b, c])
```

둘은 별개 구현이 아니라 같은 런타임 함수다. 따라서 해시 알고리즘 자체는
어긋날 수 없고, 실제 위험은 **인코딩**에 있다.

- 도메인 태그 패딩: `pad(32, "ONCE/nf")` = UTF-8 바이트 + 오른쪽 0 패딩
- 금액 변환: `faceAmount as Field as Bytes<32>` = `convertBigintToBytes(32, x)`
- 벡터 길이와 인자 순서

이 셋이 어긋나면 증명이 조용히 실패한다. 그래서 `packages/crypto`를 독립적으로
구현하고, **컴파일러가 생성한 `pureCircuits`와 직접 대조**하는 라운드트립
테스트를 가장 먼저 만들었다 (`packages/crypto/test/roundtrip.spec.ts`).
회로 소스가 바뀌면 이 테스트가 즉시 깨진다.

금액 경계값(`0`, `1`, `2^32`, `2^64-1`)까지 일치를 확인했다.

---

## S2: 컨트랙트의 자금 보관과 원자적 지급

**질문**: 컨트랙트가 토큰을 보관하고 회로 실행과 같은 트랜잭션에서 지급할 수 있는가.

**결과**: 가능하다. 표준 라이브러리가 unshielded 토큰 연산을 제공한다.

```
mintUnshieldedToken(domainSep, value, recipient): Bytes<32>
sendUnshielded(color, amount, recipient): []
receiveUnshielded(color, amount): []
```

`sendUnshielded`를 `finance` 회로 안에서, `usedNullifiers.insert(nf)` 바로 뒤에
호출한다. 둘은 같은 회로 실행이므로 쪼갤 수 없다. **INV-3이 선언이 아니라
구조로 성립한다.**

→ **폴백 A를 쓰지 않는다.** 원자성 주장을 "대출 승인 기록"으로 축소할 필요가
없고, 데모에서 금융사 잔액이 실제로 줄어드는 것을 숫자로 보여줄 수 있다.

데모 자금은 컨트랙트가 자체 발행한 토큰이다. 스테이블코인이나 실제 자산이
아니며, 그렇게 주장하지 않는다 (CONTEXT §8).

---

## S3: 회로 내 Merkle 멤버십

**질문**: 회로 안에서 Merkle 멤버십 검증이 가능하고 비용이 감당되는가.

**결과**: 가능하다. 그리고 예상보다 좋다.

원장 ADT `HistoricMerkleTree<10, Bytes<32>>`를 쓰면 트리 자체가 온체인에 있고,
**TypeScript에서 경로를 직접 얻을 수 있다**.

```
회로:  invoiceTree.checkRoot(merkleTreePathRoot<10, Bytes<32>>(path))
TS:    ledger.invoiceTree.findPathForLeaf(leaf)  // MerkleTreePath | undefined
```

이 덕분에 `packages/crypto`에 Merkle 트리를 다시 구현하지 않았다. TS 트리와
회로 트리가 어긋날 위험 자체가 없어진다. SPEC §7이 예상한
`buildMerkleTree` / `merkleProof`는 **의도적으로 만들지 않았다.**

`HistoricMerkleTree`를 고른 이유는 `checkRoot`가 과거 루트도 인정하기
때문이다. 발급 기관이 새 채권을 등록해도 이미 준비된 신청이 무효화되지
않는다. 중복 방어에는 영향이 없다. nullifier 검사는 언제나 현재 상태를 본다.

→ **폴백 B를 쓰지 않는다.**

리프는 `H("ONCE/leaf", invoiceId, faceAmount, ownerPk)`이므로 온체인에
올라가는 것은 해시뿐이다. 채권 내용이 드러나지 않는다.

---

## S4: 동시 제출

**질문**: 같은 nullifier로 두 트랜잭션이 거의 동시에 들어오면 하나만 성공하는가.

**결과**: 하나만 성공한다. `test/attacks/a5-concurrent-requests.spec.ts`에서
2건·5건 동시 신청을 확인했고, 총 지출이 정확히 한 건분이다.

성립 근거는 회로 안의 이 줄이다.

```
assert(!usedNullifiers.member(disclose(nf)), "nullifier already used");
```

이 검사는 **증명 생성 시점이 아니라 실행 시점의 공개 상태**를 본다.
동시에 도착한 두 트랜잭션은 블록 안에서 순서가 정해지고, 나중 것은 이미
삽입된 nullifier를 보고 실패한다.

---

## S5: 백엔드에서 증명 생성·제출

**질문**: 브라우저 지갑이 아니라 Node 프로세스에서 증명 생성과 제출이 가능한가.

**확인된 것**: `@midnight-ntwrk/compact-runtime`이 Node에서 문제없이 돌아간다.
컴파일된 회로를 Node에서 실행하고, 원장 상태를 전이시키고, 모든 assert 경로를
검증하는 것까지 확인했다 (`packages/chain`, `test/attacks` 14건).

**아직 확인하지 않은 것**: 실제 proof server에 붙어 증명을 생성하고 테스트넷
노드에 제출하는 것. 이건 G4의 범위다.

→ 폴백 C(브라우저 + Lace)로 전환하지 않는다. 다만 G4를 통과하기 전까지
"백엔드 제출 가능"을 확정된 사실로 적지 않는다.

---

## S6: 브라우저 지갑 실행 가능성

**질문**: 데모를 넘어, 모르는 사람이 접속해 자기 지갑으로 서명할 수 있는가.

| 항목 | 결과 |
|---|---|
| S6-a 지갑 주입 | ✅ 확인 |
| S6-b 브라우저 증명 생성 | ✅ **실측 평균 0.88s** (7건, 최대 1.37s) |
| S6-c 브라우저 private state | ✅ IndexedDB → witness → 회로 assert 통과 7회 |
| S6-d 동기화 대기 | ✅ DApp은 지갑 동기화를 하지 않는다 |
| S6-e 원격 배포 | ✅ 프론트 가능. 백엔드는 §S6-e |
| S6-f DUST 수수료 자원 | ✅ 등록 트랜잭션을 직접 만들어 해결 (§S6-f) |

---

### S6-a: Lace에 DApp Connector가 주입되는가 — ✅

브라우저 콘솔에서 직접 확인했다.

- 주입 위치는 `window.midnight`이고, **키가 `mnLace`가 아니라 UUID다.**
  문서와 예제에 흔히 나오는 `window.midnight.mnLace`로 접근하면 `undefined`가
  나온다. `Object.entries(window.midnight)`로 열거해야 한다.
- 열거된 지갑: `name: lace`, `rdns: io.lace.wallet`, `apiVersion: 4.0.1`
- `connect()` 호출 시 확장이 승인 팝업을 띄우고, 승인하면 주소와 잔액이
  돌아온다. 실제로 받았다.
- 네트워크가 맞지 않으면 `Network ID mismatch`로 거부된다. 지갑 설정에서
  Preprod를 고르면 통과한다. 이 오류를 따로 분류해야 사용자에게 무엇을
  하라고 말할 수 있다.

구현: `apps/web/src/shared/wallet/connect.ts`

### S6-b: 브라우저에서 증명을 만들 수 있는가 — ✅ 실측 완료

2026-09-19 01:12~01:17 KST, Preprod 에 컨트랙트를 배포하고 회로 7건을 호출했다.
전부 브라우저 + Lace 경로다. 서명·잔액 조정·제출을 사용자 지갑이 했다.

| 단계 | 증명 | 전체 |
|---|---|---|
| 컨트랙트 배포 | — (회로 호출 없음) | 41.78s |
| registerLender A | 0.91s | 44.45s |
| registerLender B | 0.68s | 34.34s |
| fundLender A | 1.37s | 40.55s |
| fundLender B | 1.01s | 36.75s |
| registerInvoice #1 | 0.88s | 36.73s |
| registerInvoice #2 | 0.64s | 36.73s |
| registerInvoice #3 | 0.66s | 29.48s |

**증명 평균 0.88초, 최대 1.37초.** 30초 임계값에 여유가 크다. "증명" 은 브라우저 CPU 가
아니라 증명키 업로드 + 공용 proof server 왕복 + 응답이다 (§S6-b 앞부분의 구조 그대로).

전체 30~45초 중 증명은 1초 남짓이고 **나머지는 지갑 승인 대기와 블록 확정 대기**다.
사람이 팝업을 누르는 시간이 포함돼 있어 순수 시스템 시간은 이보다 짧다.

Node 대비 배수는 내지 않는다. 같은 proof server 가 증명하므로 비교할 대상이 클라이언트
전송뿐이고, Node 경로는 dust 동기화에 막혀 같은 회로를 끝까지 돌린 적이 없다.

컨트랙트: [`52a72d93142c…`](https://preprod.midnightexplorer.com/contracts/52a72d93142c78a68871b4978d5258eb4be18d15fef44e20b4fc98dbb9ce5596). 전체 tx 목록은 `apps/deploy/deployment.json`.

### S6-c: private state를 브라우저에 둘 수 있는가 — ✅ 회로가 증명했다

`PrivateStateProvider` 13개 메서드를 IndexedDB 로 구현했다 (`apps/web/src/shared/wallet/private-state.ts`).

실측: **IndexedDB 읽기 7회, witness `issuerSecret` 호출 7회.** registerLender·fundLender·
registerInvoice 는 모두 `assert(issuerPublicKey(issuerSecret()) == issuerPk)` 를 거치고,
7건 모두 통과해 온체인 상태를 바꿨다. 즉 IndexedDB 에서 읽어 witness 로 넘긴 값이 배포
시점의 `issuerPk` 와 일치하는 비밀키였다. 로그가 아니라 **회로가 증명**한 것이다.

배포 시 발급 기관 비밀키는 저장소의 더미값(0x5e…)이 아니라 그 브라우저에서
`crypto.getRandomValues` 로 만들어 IndexedDB 에만 뒀다. 온체인 `issuerPk` = `0xcc56…5e72`.
그 브라우저만 이 컨트랙트의 발급 기관이다.

### S6-d: 접속한 사람이 동기화를 기다리는가 — ✅ 기다리지 않는다

**이게 가장 중요한 항목이었고, 답은 "DApp은 자체 동기화를 하지 않는다"다.**

근거는 우리가 쓰는 API 표면 자체다. `apps/web/src/shared/wallet/providers.ts`는
지갑을 만들지 않는다. 대신 이렇게 위임한다.

```
balanceTx  →  api.balanceUnsealedTransaction(tx)
submitTx   →  api.submitTransaction(tx)
```

잔액 조정과 제출을 **Lace가 자기 동기화 상태로** 수행한다. DApp이 UTXO를
훑을 필요가 없다. 엔드포인트도 `api.getConfiguration()`에서 받아 쓰므로
하드코딩하지 않는다.

DApp이 직접 읽는 것은 인덱서의 컨트랙트 상태뿐이고, 그건 질의지 동기화가
아니다.

**대조**: Node 경로(`apps/deploy`)는 지갑을 직접 만들기 때문에 dust 동기화를
전부 수행해야 했고, 여기서 몇 시간이 걸렸다. 브라우저 경로에는 그 단계가 없다.
이 차이가 이 방향으로 가는 이유다.

배포로 확정됐다. 지갑을 연결한 뒤 동기화를 기다린 시간은 0 이었고, 8건의 트랜잭션이
지갑의 잔액 조정과 제출로 확정됐다.

### S6-e: 원격 배포 — ✅ 프론트는 가능

**프론트**

- Node 전용 모듈 없음. `apps/web/src`에 `node:*` import가 없다.
- 워크스페이스 의존은 `@once/contract` 하나. 컴파일러 생성 코드이고
  `compact-runtime`은 브라우저에서 돈다.
- WASM은 `next.config.mjs`의 `asyncWebAssembly`로 처리한다.
  `isomorphic-ws`는 브라우저 전역 `WebSocket`으로 별칭한다.
- `next build` 통과. 정적 라우트 6개.
- 증명키 20MB를 `public/zk`로 서빙한다. `predev`/`prebuild`가
  `contracts/managed`에서 복사한다. 저장소에는 `contracts/managed`만 커밋한다.

**외부 서비스 CORS** (원격 origin에서 preflight 실측)

| 대상 | allow-origin |
|---|---|
| `indexer.preprod.midnight.network/api/v3/graphql` | `*` |
| `midnight-preprod.blockfrost.io/api/v0` | `*` |
| `proof-server.preprod.midnight.network` | 요청 origin 반사 |

→ 브라우저에서 직접 붙는 데 막히는 것이 없다.

**백엔드**

지금의 `apps/api`는 시뮬레이터를 들고 있고 채권 원문을 서버 메모리에 둔다.
사용자가 자기 지갑으로 서명하는 방향에서는 이 역할이 줄어든다. 어디에 올릴지는
그 설계가 정해진 뒤에 결정한다.

### S6-f: DUST — 수수료 자원이 없어 첫 배포가 막혔다

첫 시도는 `Wallet.InsufficientFunds: could not balance dust` 로 죽었다. 잔액 5,000 tNIGHT
이 있었지만 수수료는 DUST 로 내고, `getDustBalance()` 가 `{cap: 0, balance: 0}` 이었다.

**원인**: DUST 는 NIGHT 을 들고만 있으면 생기지 않는다. 원장 스펙 —
"A new DUST UTXO is created if and only if a NIGHT UTXO is created *and its key has a table entry*."
그 entry 를 만드는 `DustRegistration` 이 없었다.

**Lace 4.0.1 에는 그 UI 가 없다.** Portfolio · tNIGHT 화면 · Settings→Midnight · Account Center
를 전부 확인했다. DApp 커넥터에도 등록 메서드가 없다 (21개 메서드 전수 확인; dust 는
`getDustBalance`·`getDustAddress` 읽기 둘뿐).

**해결**: 등록 트랜잭션을 직접 조립했다 (`apps/web/src/shared/wallet/dust-registration.ts`).

```
DustRegistration(marker, nightKey, dustAddress, allowFeePayment, signature)
DustActions(markerS, markerP, ctime, [], [registration])
Intent.new(ttl).dustActions = ↑
서명 대상 = Intent.signatureData(segmentId)
Transaction.fromParts → prove → balanceUnsealedTransaction → submitTransaction
```

- night 검증키: `signData()` 가 `verifyingKey` 를 함께 돌려준다 (버리는 서명 1회로 획득)
- dust 주소: `getDustAddress()` 의 bech32m → `DustAddress.codec.decode` → `DustPublicKey`
- 수수료: 스펙의 **자기자금 등록**. 지갑이 잔액 조정에서 NIGHT 자기 전송을 넣었고,
  그 입력의 소급 DUST 로 등록 수수료를 냈다 (Lace 에 "+5,000 Pending" 으로 보였던 것)

결과: 블록 2605723 에서 `registeredForDustGeneration: true`. `cap` 이 0 에서
25,000,000,000,000,000,000 으로, `balance` 가 곧바로 4.67×10^18 로 올랐다. 그 뒤 8건이
전부 이 DUST 로 수수료를 냈다.

두 가지를 미리 걱정했는데 둘 다 문제가 아니었다: `signData` 의 접두사(원장 검증과
어긋날 가능성)와 NIGHT 입력 부재(지갑이 채웠다). 첫 시도는 `makeIntent()` 가 이미
sealed 된 트랜잭션을 돌려줘 역직렬화 헤더가 어긋나 실패했고, 직접 조립으로 바꿨다.

**미해결 의문**: 인덱서의 dust 쿼리는 `dustGenerationStatus(cardanoRewardAddresses)` 처럼
**Cardano reward 주소** 기준이다. 우리는 Midnight 측 `DustRegistration` 으로 등록했고
그게 동작했다. 두 경로가 어떻게 관계되는지는 확인하지 못했다. 동작 사실만 적는다.

### S6이 답하지 않는 것: 금융사의 승인 행위

목표 상태는 "한 명이 신청하고 다른 한 명이 심사·승인한다"인데, **현재 회로에는
금융사가 서명하는 지점이 없다.**

`finance(lender, amount, recipient)`는 납품업체가 부르는 단일 트랜잭션이고,
네 검사를 통과하면 그 자리에서 금융사 금고에서 자금이 나간다. 금융사는
서명하지 않는다. 사전에 `fundLender`로 예치해 둔 것이 승인을 대신한다.

또 `registerLender`와 `fundLender`는 `issuerSecret`을 요구한다. 모르는 사람이
와서 금융사가 되려면 발급 기관이 등록해 줘야 한다.

두 사람이 각자 서명하는 구조로 가려면 회로를 바꿔야 하고, 그건 S6의 범위
밖이다. 바꾸는 순간 INV-3(검사와 지급이 한 트랜잭션)을 어떻게 지킬지가
새 문제가 된다.

---

## 로컬 실행의 한계: 정직하게

`packages/chain`의 시뮬레이터는 **컴파일된 실제 회로 코드**를 실행한다.
목 구현이 아니다. 따라서 A1~A8의 거부는 애플리케이션 계층이 아니라 회로의
assert가 만든 결과다.

그렇지만 로컬 실행이 증명하지 **못하는** 것이 있다.

- 증명 트랜스크립트의 실제 검증. 로컬은 회로 로직을 직접 실행할 뿐,
  노드가 수행하는 트랜스크립트 재생·검증을 대신하지 않는다.
- 합의 계층의 트랜잭션 순서 결정. 시뮬레이터는 제출 큐로 직렬화를
  모델링했다. 실제 체인의 블록 포함 규칙과 같지 않다.

A5·A6의 주장은 **회로가 실행 시점 상태를 본다**는 것이고 그건 로컬에서
증명된다. 전체 스택에서의 확인은 G4에 남아 있다.

---

## 명세와 달라진 점

SPEC §6.1은 의사코드이며, 실제 문법을 확인해 작성하라고 지시한다 (§0.1).
확인 결과 아래 세 가지를 바꿨다. 모두 제품 주장을 **약화하지 않는** 방향이다.

| 명세 | 구현 | 이유 |
|---|---|---|
| `issuerRoot: Field` + `updateIssuerRoot(newRoot)` | `invoiceTree: HistoricMerkleTree` + `registerInvoice(leaf)` | 원장 ADT를 쓰면 TS가 `findPathForLeaf`로 경로를 얻는다. TS 트리 재구현이 사라져 S1/S3 불일치 위험이 없어진다 |
| nullifier 입력에 `issuerPk` (§6.2) | `issuerId` (INV-1 문구 그대로) | `issuerPk`를 쓰면 발급자 키 교체 시 nullifier가 바뀌어 과거 중복을 놓친다. `issuerId`는 생성자에서 고정되고 변경 경로가 없다 |
| `vault: TokenBalance` 단일 잔고 | `lenderVault: Map<lender, Uint<64>>` | 금융사별 잔액이 분리돼야 A5에서 "어느 쪽 자금이 보존됐는지"를 숫자로 보일 수 있다 |

해시 입력에는 전부 도메인 태그를 붙였다 (`ONCE/leaf`, `ONCE/nf`, `ONCE/cm`,
`ONCE/owner-pk`, `ONCE/issuer-pk`). 세 값이 서로 다른 도메인에 속한다는 것을
길이가 아니라 태그로 보장한다.
