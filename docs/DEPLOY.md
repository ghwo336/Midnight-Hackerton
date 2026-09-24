# 테스트넷 배포

**심사에는 필요 없다.** 심사위원은 README의 "바로 실행하기"로 충분하다.
이 문서는 우리가 직접 Preprod에 올릴 때의 절차다.

---

## 0. 경로가 둘이고, 쓰는 것은 하나다

| | 브라우저 + 지갑 **(정본)** | Node 지갑 SDK (폐기, §5) |
|---|---|---|
| 서명 | 사용자 지갑 | 서버가 가진 시드 |
| 첫 동기화 | **없다** | **8시간.** 한 번도 끝까지 못 갔다 |
| 수수료 | 지갑이 밸런싱 | 직접 맞춰야 함 |
| 실제로 배포된 것 | ✅ `52a72d93…` (README §5) | ❌ |

갈린 이유는 [SPIKE.md](SPIKE.md) §S6-d다. DApp 커넥터는 지갑 작업을 지갑에
위임한다 — `balanceUnsealedTransaction`은 지갑이 **자기 동기화 상태로**
밸런싱하고 `submitTransaction`도 지갑이 한다. **DApp은 지갑을 만들지도
동기화하지도 않는다.** 그래서 §5의 8시간이 통째로 사라졌다.

§5는 지우지 않고 남긴다. 측정 기록이 정직하고, 체크포인트 재개 설계가
같은 문제를 다시 만나면 쓸 값어치가 있다.

---

## 1. 정본: 브라우저 + 지갑

### 1.1 지갑

Midnight 커넥터 지갑을 설치한다 (Lace · 1am 등). 앱은 키 이름에 의존하지
않고 `window.midnight`를 열거하므로 어느 쪽이든 잡힌다.

- 네트워크를 **Preprod로** 바꾼다. 안 하면 연결이 `Network mismatch`로 거부된다
- **주소를 복사하기 전에** 바꿔야 한다. 같은 시드에서 나온 주소라도 mainnet
  주소 문자열은 preprod faucet이 받지 않는다
- **확장은 하나만 설치한 프로필에서 작업해라.** 연결 코드가 주입된 것 중
  첫 번째를 무조건 고르고 선택 UI가 없다

### 1.2 tNIGHT

https://faucet.preprod.midnight.network/ 에 주소를 넣는다. Cloudflare
Turnstile 캡차가 있어 **자동화할 수 없다. 사람이 직접 해야 한다.**
5,000 tNIGHT가 오고 반영에 2~3분 걸린다.

`Services are currently unavailable`이 뜨면 서버 쪽 문제다. 5~10분 뒤
재시도하거나 Midnight Discord `kr-chat`에 물어본다.

### 1.3 DUST 등록 ← 건너뛰면 아무 트랜잭션도 못 낸다

§2를 보라. tNIGHT만으로는 0건도 못 낸다.

### 1.4 배포

```bash
pnpm dev:preprod        # → http://localhost:3040/devtools
```

지갑 연결 → **[배포 시작]**. 8단계이고 **각 단계마다 지갑 승인이 한 번씩**
뜬다. 실측 29.5~44.5초/건이고 그중 증명은 0.64~1.37초다 — 나머지는 승인과
블록 확정이다.

발급 기관 비밀키가 없으면 **그 브라우저에서 새로 만든다**
(`ensureIssuerSecret`). 즉 키 파일을 못 받았어도 자기 소유의 컨트랙트는
올릴 수 있다. 못 하는 것은 *남이 배포한* 컨트랙트에 채권을 발급하는 것뿐이다.

### 1.5 끝나면 바로

1. **[키 내보내기]** — `/devtools` → 발급 기관 키. 브라우저 데이터를 지우면
   그 컨트랙트의 발급 권한이 **영구히** 사라진다. 되살릴 방법이 없다
2. **[실측 복사]** — 단계별 소요·증명 시간 보고서
3. README §5와 `apps/deploy/deployment.json`을 **손으로** 갱신 (§4)

---

## 2. 수수료는 DUST로 낸다 — tNIGHT만으로는 0건도 못 낸다

먼저 틀린 통념을 지운다. **"NIGHT을 들고 있으면 DUST가 생긴다"는 사실이
아니다.** 원장 스펙은 이렇게 말한다.

> A new DUST UTXO is created if and only if a NIGHT UTXO is created
> **and its key has a table entry.**

그 table entry를 만드는 것이 `DustRegistration`이다. 없으면 잔액이 5,000
tNIGHT여도 `getDustBalance()`가 `{cap: 0, balance: 0}`이고, 첫 배포가
`Wallet.InsufficientFunds: could not balance dust`로 죽는다.

Lace 4.0.1에는 그 UI가 없고 DApp 커넥터에도 등록 메서드가 없다(21개 전수
확인, dust는 읽기 둘뿐). 그래서 등록 트랜잭션을 직접 조립했다 —
`apps/web/src/shared/wallet/dust-registration.ts`.

### 하는 법

> **현재 이 버튼은 패널에 없다 (2026-09-24).** 1am 에서는 proof server 가
> 수수료를 대납하고 등록 트랜잭션 자체도 대납을 타므로, 대납이 막힌
> 상황에서는 이 버튼도 같이 막힌다. 누를 수 없는 버튼을 내놓지 않는다.
> 조립 코드(`apps/web/src/shared/wallet/dust-registration.ts`)와 테스트는
> 그대로 있고, 필요해지면 지갑 패널에 버튼을 다시 놓으면 된다.
> 아래 절차와 진단표는 그때를 위해 남긴다.

`/devtools` → 지갑 연결 → `수수료 자원 (DUST)`가 `0 / 0`이면 그 아래
**[DUST 생성 등록]** 버튼이 나타난다. **0일 때만 나온다.**

지갑 승인이 **2회** 뜬다 — night 검증키를 얻기 위한 버리는 서명 1회와 실제
등록 서명 1회다. 단계 로그 8줄이 찍히고 [로그 복사]로 떠낼 수 있다.

성공하면 마지막 줄이 `등록 후 DUST · balance=… cap=…`이고 둘 다 0이 아니다.

### 실패하면 멈춘 줄이 곧 원인이다

지갑마다 커넥터 구현이 달라서, 이 표가 사실상 지갑 능력 점검표다.
**채권을 한 장도 쓰지 않으므로 온체인 공격 재현 전에 여기를 먼저 통과해라.**

| 마지막으로 찍힌 줄 | 죽은 지점 | 뜻 |
|---|---|---|
| (아무것도 없음) | `getDustAddress` 등 | 읽기 메서드부터 다르다 |
| `NIGHT 잔액` | `signData` | keyType `unshielded` 서명 미지원 |
| `night 검증키 확보` | 응답에 `verifyingKey` 없음 | 서명할 바이트를 만들 수 없다 |
| `트랜잭션 조립` | `getProvingProvider` | 증명 위임 경로가 없다 |
| `증명 완료` | `balanceUnsealedTransaction` | **여기서 막히면 A5·A6도 못 한다** |
| `잔액 조정 완료` | `submitTransaction` | 제출 경로가 없다 |

### 실측

블록 2605723에서 `registeredForDustGeneration: true`. `cap`이 0에서
2.5×10^19로, `balance`가 곧바로 4.67×10^18로 올랐다. 그 뒤 초기 설정 8건이
전부 이 DUST로 수수료를 냈다.

닭과 달걀처럼 보이지만 스펙에 탈출구가 있다 — **자기자금 등록.** 등록하는
주소의 unshielded 입력이 같은 트랜잭션 안에 있으면 그 입력의 소급 DUST로
등록 수수료를 낸다. 자세한 것은 [SPIKE.md](SPIKE.md) §S6-f.

> **미해결**: 인덱서의 dust 쿼리는 Cardano reward 주소 기준인데 우리는
> Midnight 측 `DustRegistration`으로 등록했고 그게 동작했다. 두 경로의
> 관계는 모른다. 동작 사실만 적는다.

---

## 3. 회로를 고쳤을 때만 — 툴체인과 proof server

`contracts/managed/`가 커밋돼 있어서 평소에는 둘 다 필요 없다.

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31      # 라이브 네트워크가 쓰는 버전. 0.34는 배포 불가
```

버전이 왜 0.31인지는 [VERSIONS.md](VERSIONS.md)를 본다.

proof server는 **Node 배포 경로(§5)에만** 필요하다. 브라우저 경로는 지갑의
증명 위임(`getProvingProvider`)이나 원격 proof server를 쓴다.

```bash
docker run -d --name once-proof-server -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3 'midnight-proof-server -v'
```

---

## 4. ⚠️ `record-deployment.mjs`를 돌리지 마라

`scripts/record-deployment.mjs`는 README의 `<!-- DEPLOYMENT:BEGIN/END -->`
사이를 통째로 갈아치운다. 그런데 현재 그 블록은 **브라우저 경로로 배포한
기록**이고 손으로 쓴 것이다 — tx 8건의 해시·블록·소요·증명 시간 표와
인덱서로 디코드한 온체인 상태 검증까지 들어 있다. 스크립트가 만드는 표에는
그게 없다. 돌리면 배포 증거가 줄어든다.

`scripts/sync-until-done.sh`가 이것을 자동으로 부른다. **그 스크립트도
돌리지 마라.**

README §5는 손으로 갱신한다.

---

## 5. 부록 — 폐기된 Node 지갑 SDK 경로

**쓰지 않는다.** 첫 동기화가 8시간이고 브라우저 경로에는 그 단계가 아예 없다.
측정 기록으로만 남긴다.

```bash
pnpm --filter @once/deploy address    # 주소 출력
pnpm --filter @once/deploy deploy     # 동기화 → 배포 → 초기 설정 8건
```

비밀값은 기본값을 쓰지 않는다. 공개 저장소에 적힌 더미키로 배포하면 누구나
발급 기관 권한 회로를 호출할 수 있어 A8 주장이 무너진다. `openssl rand -hex 32`로
만들어 `.env.preprod`에 넣는다 (커밋 금지).

### 첫 지갑 동기화: 정직한 측정치

Preprod는 블록이 250만 개가 넘는다. 새 지갑은 인덱서의
`shieldedTransactions(sessionId, index)`를 index 0부터 구독해 전체 히스토리를
재생한다. 공개 SDK에 시작 인덱스 옵션이 없어 **첫 1회는 우회할 방법이 없다.**

| 시도 | 힙 상한 | 결과 |
|---|---|---|
| 1 | 기본(~4GB) | 86초에 힙 3.4GB, **OOM** |
| 2 | 12GB | 26분 시점 RSS 4.1GB, **끝나지 않아 중단** |
| 3 | 4GB | 90초에 힙 3.35GB, **OOM** |
| 4 | 8GB | CPU 478% 관측, 45초 만에 수동 중단 |

메모리는 90초 안에 3.4GB에 도달하고 이후 완만히 는다. **힙 8GB 이상이
필요하다.** 소요 시간은 모른다 — 26분에 안 끝났다는 것만 안다.

### CPU

`nice -n 15`는 **CPU를 제한하지 못했다.** 우선순위만 낮출 뿐이라 코어가 놀고
있으면 전부 쓴다. 478%(약 5코어)가 관측됐다. macOS의 `taskpolicy -b`도
효과가 없었다(397% → 375%). 실제로 잡은 것은 이것이다.

```bash
UV_THREADPOOL_SIZE=2 node --v8-pool-size=2 --max-old-space-size=8192 ...
```

`taskpolicy`는 macOS 전용이라 스크립트에서 제거했다.

### 작업 중단

`kill`로 래퍼만 죽이면 실제 작업을 하는 자식 node가 살아남는다. 한 번 그래서
죽인 줄 알았던 프로세스가 26분을 더 돌았다.

```bash
./scripts/stop-all.sh
```

### 캐시

`.data/wallet-sync.json`에 지점이 저장되고 다음 실행은 거기서 이어간다.
단, 그 1회를 완료하지 못했으므로 캐시 경로는 실측으로 검증되지 않았다.

---

## 6. 배포 후

1. `deployment.json`과 README §5를 **손으로** 갱신한다 (§4)
2. 프론트 상단 체인 표시가 실제 네트워크로 바뀌는지 확인
3. A5·A6을 테스트넷에서 재현한다. 로컬은 시뮬레이터 큐가 직렬화한 결과이므로
   **실제 합의에서도 하나만 확정되는지는 여기서만 증명된다**
4. 증명 생성·확정 시간을 실측해 [TEST_REPORT.md](TEST_REPORT.md)에 기록한다

> A5·A6은 채권을 **영구 소모**한다. 원본 컨트랙트에서 바로 누르지 말고,
> 자기 컨트랙트를 하나 올려 거기서 리허설한 뒤에 가라 (§1.4).
