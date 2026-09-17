# 현재 상태와 다음 할 일

작업을 이어받는 사람(또는 새 세션)이 맥락을 빨리 잡기 위한 문서다.
제품 설명은 [README.md](../README.md), 측정치는 [TEST_REPORT.md](TEST_REPORT.md)에 있다.

마지막 갱신: 2026-09-17

---

## 한 줄 요약

**G4(테스트넷 배포)를 제외한 전부가 끝났고, G4는 사람 없이 돌아가는 중이다.**

---

## 지금 돌고 있는 것

```bash
scripts/sync-until-done.sh      # nohup으로 실행 중. SSH 끊겨도 유지된다
```

이 감독 루프가 끝까지 자동으로 간다.

```
지갑 동기화 → (OOM이면 체크포인트에서 자동 재시작) → 컨트랙트 배포
  → registerLender×2 → fundLender×2 → registerInvoice×3
  → scenario.ts (A5·A6 테스트넷 재현)
  → record-deployment.mjs (README §5 배포 증거 자동 반영)
```

### 확인 방법

```bash
grep "^\[감독\]" /tmp/sync.log | tail -20     # 파이프라인 단계
grep -E "^  \[[0-9.]+분\] [0-9]" /tmp/sync.log | tail -3   # 동기화 진행률
cat apps/deploy/deployment.json               # 배포 주소·tx
cat apps/deploy/scenario-result.json          # A5·A6 결과
./scripts/stop-all.sh                         # 전부 정리
```

`[감독] 파이프라인 완료.`가 보이면 끝난 것이다.

### 주의

`record-deployment.mjs`는 **A5 확정이 1건이 아니면 종료 코드 2로 실패**한다.
동시 신청에서 두 건이 확정되면 제품의 핵심 주장이 무너진 것이므로 조용히
넘어가면 안 된다. 로그에 경고가 남는다.

---

## 동기화에 대해 알아야 할 것

Preprod 첫 동기화는 인덱스 1,529,726개를 처리한다. 구간마다 블록 밀도가
크게 달라 속도가 200/s에서 6000/s까지 흔들린다.

**메모리가 진행에 비례해 늘고 결국 OOM으로 죽는다** (실측: 69%에서 힙 6.65GB).
힙을 키우는 것으로는 못 푼다. 이 머신은 16GB이고 Docker VM이 4GB를 쓴다.

그래서 이렇게 한다: 2분마다 체크포인트를 저장하고, 죽으면 재시작한다.
**재시작하면 힙이 초기화되므로** 매 회차가 직전 지점부터 이어가며 전진한다.

CPU는 `UV_THREADPOOL_SIZE=2` + `--v8-pool-size=2`로 묶었다.
`nice`와 `taskpolicy -b`는 효과가 없었다 (측정: 397% → 375%).

---

## 방향 전환 검토 중: 브라우저 + Lace 서명

백엔드가 대신 서명하는 현재 방식을, 최소한 납품업체 역할만이라도
브라우저 + Lace로 옮기는 안을 검토했다. **기존 백엔드 서명 코드는 지우지 않았다.**

### S6 스파이크 결과

| ID | 질문 | 결과 |
|---|---|---|
| S6-a | Lace에 DApp Connector가 주입되는가 | ⬜ **사람이 확인해야 함** |
| S6-b | 브라우저에서 증명 생성이 가능한가 | ✅ proof server CORS 통과 (실제 브라우저로 확인) |
| S6-c | private state를 브라우저에 둘 수 있는가 | ✅ IndexedDB provider + FetchZkConfigProvider |
| S6-d | 지갑 동기화를 DApp이 따로 해야 하는가 | ✅ **아니다. 지갑이 한다** |

**S6-d가 가장 중요하다.** DApp Connector는 지갑 작업을 Lace에 위임한다.
`balanceUnsealedTransaction`은 지갑이 자기 동기화 상태로 밸런싱하고,
`submitTransaction`도 지갑이 한다. **DApp은 지갑을 만들거나 동기화하지 않는다.**
위에서 설명한 동기화 문제가 브라우저 경로에는 아예 없다.

`getProvingProvider()`로 증명 생성까지 지갑에 위임할 수 있어 proof server도
선택사항이 된다.

필요한 패키지는 전부 npm에 있다:
`dapp-connector-api@4.0.1`, `midnight-js-fetch-zk-config-provider@4.1.1`,
`midnight-js-dapp-connector-proof-provider@4.1.1`.

### S6-a: 사람이 할 일

Lace 확장 설치, 시드 입력, Preprod 선택, 연결 승인은 자동화할 수 없다.
브라우저 콘솔에서:

```js
Object.keys(window.midnight ?? {})                 // 주입된 지갑 목록
window.midnight?.mnLace                            // Lace 별칭
await window.midnight.mnLace.connect('preprod')    // 연결 → ConnectedAPI
```

`connect()`가 `'preprod'`를 받는 것은 문서로 확인했다.
이것만 확인되면 구현 계획을 세울 수 있다.

---

## 세션을 이어가려면

Claude 세션은 SSH가 끊기면 멈춘다. 계속 붙여두려면 tmux를 쓴다.

```bash
tmux new -s once
cd /Users/Shared/srv/midngiht-probability
claude
# 나갈 때: Ctrl+b 누르고 d
# 돌아와서: tmux attach -t once
```

다만 claude는 턴 단위로 동작한다. tmux는 "프로세스가 안 죽는다"를 보장할 뿐,
지시 없이 몇 시간 알아서 계속하지는 않는다. 위 파이프라인은 claude 없이도
끝까지 가므로, 단순히 결과만 필요하면 tmux는 필요 없다.
