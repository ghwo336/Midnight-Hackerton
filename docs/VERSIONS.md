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
