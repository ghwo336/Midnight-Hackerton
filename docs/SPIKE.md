# 스파이크 결과

SPEC §2의 다섯 가지를 본 구현 전에 확인했다. **폴백 A·B·C 모두 불필요하다.**

| ID | 질문 | 결과 | 분기 |
|---|---|---|---|
| S1 | 회로와 TS가 같은 해시를 쓸 수 있는가 | ✅ 일치 | 진행 |
| S2 | 컨트랙트가 토큰을 보관하고 같은 트랜잭션에서 지급할 수 있는가 | ✅ 가능 | 폴백 A 불필요 |
| S3 | 회로 안에서 Merkle 멤버십 검증이 가능한가 | ✅ 가능 | 폴백 B 불필요 |
| S4 | 같은 nullifier로 두 트랜잭션이 오면 하나만 성공하는가 | ✅ 하나만 | 진행 |
| S5 | 백엔드에서 증명 생성·제출이 가능한가 | ⚠️ 부분 확인 | §S5 참조 |

---

## S1 — 해시 일치

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

## S2 — 컨트랙트의 자금 보관과 원자적 지급

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

## S3 — 회로 내 Merkle 멤버십

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
않는다. 중복 방어에는 영향이 없다 — nullifier 검사는 언제나 현재 상태를 본다.

→ **폴백 B를 쓰지 않는다.**

리프는 `H("ONCE/leaf", invoiceId, faceAmount, ownerPk)`이므로 온체인에
올라가는 것은 해시뿐이다. 채권 내용이 드러나지 않는다.

---

## S4 — 동시 제출

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

## S5 — 백엔드에서 증명 생성·제출

**질문**: 브라우저 지갑이 아니라 Node 프로세스에서 증명 생성과 제출이 가능한가.

**확인된 것**: `@midnight-ntwrk/compact-runtime`이 Node에서 문제없이 돌아간다.
컴파일된 회로를 Node에서 실행하고, 원장 상태를 전이시키고, 모든 assert 경로를
검증하는 것까지 확인했다 (`packages/chain`, `test/attacks` 14건).

**아직 확인하지 않은 것**: 실제 proof server에 붙어 증명을 생성하고 테스트넷
노드에 제출하는 것. 이건 G4의 범위다.

→ 폴백 C(브라우저 + Lace)로 전환하지 않는다. 다만 G4를 통과하기 전까지
"백엔드 제출 가능"을 확정된 사실로 적지 않는다.

---

## 로컬 실행의 한계 — 정직하게

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
