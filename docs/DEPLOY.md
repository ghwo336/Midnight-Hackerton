# 테스트넷 배포

**심사에는 필요 없다.** 심사위원은 README의 "바로 실행하기"로 충분하다.
이 문서는 우리가 직접 Preprod에 올릴 때의 절차다.

---

## 1. 준비

### 툴체인

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31      # 라이브 네트워크가 쓰는 버전. 0.34는 배포 불가
```

버전이 왜 0.31인지는 [VERSIONS.md](VERSIONS.md)를 본다.

### proof server

로컬 모드에는 필요 없고 **배포에만** 필요하다.

```bash
docker run -d --name once-proof-server -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3 'midnight-proof-server -v'
```

### 비밀값

배포 경로는 기본값을 쓰지 않는다. 없으면 중단된다.

```bash
openssl rand -hex 32      # 두 번 실행
```

`.env` (커밋 금지):

```
ISSUER_SECRET_KEY=0x...
SUPPLIER_SECRET_KEY=0x...
DEPLOY_WALLET_SEED=...          # pnpm --filter @once/deploy address 로 생성
PROOF_SERVER_URL=http://127.0.0.1:6300
```

공개 저장소에 적힌 더미키로 배포하면 누구나 발급 기관 권한 회로를 호출할
수 있어 A8(발급자 사칭 차단) 주장이 무너진다. 그래서 필수로 막아 두었다.

### 자금

```bash
pnpm --filter @once/deploy address    # 주소 출력
```

https://faucet.preprod.midnight.network/ 에 주소를 넣는다. Cloudflare
Turnstile 캡차가 있어 **자동화할 수 없다. 사람이 직접 해야 한다.**
5000 tNight가 오고, 반영에 2~3분 걸린다. tNight를 위임하면 수수료용
DUST가 자동 생성된다.

---

## 2. 배포

```bash
pnpm --filter @once/deploy deploy
```

순서: 지갑 동기화 → 잔액 확인 → 컨트랙트 배포 →
`registerLender`×2 → `fundLender`×2 → `registerInvoice`×3.
결과는 `apps/deploy/deployment.json`에 기록된다.

---

## 3. 첫 지갑 동기화: 정직한 측정치

**이 단계가 무겁다. 아직 한 번도 끝까지 가보지 못했다.**

Preprod는 블록이 250만 개가 넘는다. 새 지갑은 인덱서의
`shieldedTransactions(sessionId, index)`를 index 0부터 구독해 전체
히스토리를 재생한다. 공개 SDK에는 시작 인덱스를 지정하는 옵션이 없다
(`startWithSecretKeys` = 전체 동기화, `restore(직렬화문자열)` = 이전
상태 복원). 그래서 **첫 1회는 우회할 방법이 없다.**

### 실제로 관측한 것

| 시도 | 힙 상한 | 결과 |
|---|---|---|
| 1 | 기본(~4GB) | 86초에 힙 3.4GB, **OOM** |
| 2 | 12GB | 26분 시점 RSS 4.1GB, **끝나지 않아 중단** |
| 3 | 4GB | 90초에 힙 3.35GB, **OOM** |
| 4 | 8GB | CPU 478% 관측, 45초 만에 수동 중단 |

- 메모리는 90초 안에 3.4GB에 도달하고 이후 완만히 는다(26분에 4.1GB).
  **힙 8GB 이상이 필요하다.**
- **소요 시간은 모른다.** 26분에 안 끝났다는 것만 안다. 진행률 지표를
  아직 못 읽어서 ETA를 낼 수 없었다.

### CPU에 대한 경고

`nice -n 15`를 걸었지만 **CPU를 제한하지 못했다.** `nice`는 우선순위만
낮춘다. 코어가 놀고 있으면 niced 프로세스도 전부 쓴다. 실제로 478%
(약 5코어)가 관측됐고 머신 발열이 심했다.

실제로 묶으려면 이렇게 해야 한다(아직 검증 전):

```bash
UV_THREADPOOL_SIZE=2 \
  node --v8-pool-size=2 --max-old-space-size=8192 ...
```

또는 macOS에서 `taskpolicy -b`. 다만 코어를 줄이면 **더 느려진다.**

### 작업 중단

반드시 이걸 쓴다. `kill`로 래퍼만 죽이면 실제 작업을 하는 자식 node가
살아남는다. 한 번 그래서 죽인 줄 알았던 프로세스가 26분을 더 돌았다.

```bash
./scripts/stop-all.sh
```

### 캐시

동기화가 끝나면 `.data/wallet-sync.json`에 지점이 저장되고, 다음 실행은
거기서 이어간다. **첫 1회만 무겁다**. 단, 아직 그 1회를 완료하지
못했으므로 캐시 경로는 실측으로 검증되지 않았다.

---

## 4. 배포 후

1. `deployment.json`의 컨트랙트 주소와 tx 해시를 README §5에 옮긴다
   (`<!-- DEPLOYMENT:BEGIN -->` 블록)
2. 프론트 상단 체인 표시가 `local-circuit`에서 실제 네트워크로 바뀌는지 확인
3. A5·A6을 테스트넷에서 재현한다. 로컬은 시뮬레이터 큐가 직렬화한 결과이므로,
   **실제 합의에서도 하나만 확정되는지는 여기서만 증명된다**
4. 증명 생성·확정 시간을 실측해 [TEST_REPORT.md](TEST_REPORT.md)에 기록한다
