# 버전 고정

재현에 필요한 버전을 고정한다 (SPEC §11 G0).

| 대상 | 버전 | 확인 방법 |
|---|---|---|
| Compact 개발도구 | 0.5.2 | `compact --version` |
| Compact 컴파일러 | 0.31.1 | `compact compile --version` |
| Compact 언어 | 0.23.0 | `compact compile --language-version` |
| Compact 런타임 | 0.16.0 | `compact compile --runtime-version` |
| 원장 | ledger-8.0.2 | `compact compile --ledger-version` |
| @midnight-ntwrk/compact-runtime | 0.16.0 | `package.json` |
| Node.js | v25.8.0 | `node -v` |
| pnpm | 10.30.3 | `pnpm -v` |

## 왜 최신 툴체인이 아닌가

`compact update`는 0.34.0을 설치하지만, **그걸로 컴파일한 컨트랙트는 어느
라이브 네트워크에도 배포할 수 없다.** 0.34는 ledger 9를 타깃하는데 Preview·
Preprod·Mainnet이 전부 ledger 8(툴체인 0.31.1 / 런타임 0.16.0)에서 돈다.

0.34로 먼저 만들었다가 배포 단계에서 이 사실을 발견하고 0.31.1로 내렸다.
컨트랙트는 `pragma language_version`만 0.26 → 0.23으로 바꾸고 그대로
컴파일됐다. `HistoricMerkleTree`, `mintUnshieldedToken`, `sendUnshielded`가
전부 언어 0.23에 이미 있어서 회로 로직은 한 줄도 바뀌지 않았다.

런타임 API는 세 군데가 다르다.

| 0.19 (ledger 9) | 0.16 (ledger 8) |
|---|---|
| `convertBigintToBytes` | `convertFieldToBytes` |
| 회로가 `Promise` 반환 | 회로가 동기 |
| `createCircuitContext(circuitId, ...)` | `circuitId` 인자 없음 |
| `ctx.callContext.currentQueryContext` | `ctx.currentQueryContext` |

컴파일러 런타임 버전(`--runtime-version`)과 `@midnight-ntwrk/compact-runtime`
의존성 버전이 **반드시 같아야 한다**. 다르면 생성된 컨트랙트 코드가 런타임과
어긋나 증명이 조용히 실패한다.

## 재현 절차

```bash
# 1. Compact 툴체인 설치
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31   # 라이브 네트워크가 쓰는 버전. 최신(0.34)은 아직 배포 불가 — 아래 참조

# 2. 의존성 설치
pnpm install

# 3. 회로 컴파일 (증명키·검증키 생성 포함. 실측 약 15초, 산출물 21MB)
pnpm build:contract
#    빠른 반복용 (증명키 생략):
#    pnpm --filter @once/contract build:fast

# 4. 테스트
pnpm test
pnpm test:attacks
```

`contracts/managed/`는 빌드 산출물이므로 커밋하지 않는다. 테스트 실행 전에
반드시 3단계를 거쳐야 한다.


## 자원 한계 — 지갑 동기화

Preprod는 블록이 250만 개가 넘어서 **새 지갑의 첫 동기화가 무겁다.**
한 번은 12GB 힙을 허용한 채로 26분을 돌려 CPU 4코어를 물고 발열이 심했다.
그래서 두 가지를 걸어 두었다.

```
nice -n 15                          다른 작업이 항상 우선권을 갖는다
--max-old-space-size=4096           힙 4GB 상한
```

동기화 지점은 `.data/wallet-sync.json`에 저장된다. 첫 1회만 전체 동기화이고
그 뒤로는 마지막 지점부터 이어간다. 캐시가 깨졌거나 네트워크가 다르면
조용히 전체 동기화로 떨어진다 — 틀린 상태를 쓰지 않는다.

**작업을 멈출 때는 반드시** `scripts/stop-all.sh`를 쓴다. 래퍼만 죽이면
실제 작업을 하는 자식 node가 살아남는다. 한 번 그래서 죽인 줄 알았던
프로세스가 26분을 더 돌았다.

```bash
./scripts/stop-all.sh
```

`@midnight-ntwrk/ledger-v8`은 8.1.2로 고정한다 (`pnpm.overrides`).
두 버전이 함께 깔리면 타입이 서로 호환되지 않고 런타임에도 위험하다.
