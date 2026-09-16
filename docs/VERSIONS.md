# 버전 고정

재현에 필요한 버전을 고정한다 (SPEC §11 G0).

| 대상 | 버전 | 확인 방법 |
|---|---|---|
| Compact 개발도구 | 0.5.2 | `compact --version` |
| Compact 컴파일러 | 0.34.0 | `compact compile --version` |
| Compact 언어 | 0.26.0 | `compact compile --language-version` |
| Compact 런타임 | 0.19.0 | `compact compile --runtime-version` |
| 원장 | ledger-9.1.0.0-rc.3 | `compact compile --ledger-version` |
| @midnight-ntwrk/compact-runtime | 0.19.0 | `package.json` |
| Node.js | v25.8.0 | `node -v` |
| pnpm | 10.30.3 | `pnpm -v` |

컴파일러 런타임 버전(`--runtime-version`)과 `@midnight-ntwrk/compact-runtime`
의존성 버전이 **반드시 같아야 한다**. 다르면 생성된 컨트랙트 코드가 런타임과
어긋나 증명이 조용히 실패한다.

## 재현 절차

```bash
# 1. Compact 툴체인 설치
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
export PATH="$HOME/.local/bin:$PATH"
compact update

# 2. 의존성 설치
pnpm install

# 3. 회로 컴파일 (증명키 생성 포함, 수 분 소요)
pnpm build:contract
#    빠른 반복용 (증명키 생략):
#    pnpm --filter @once/contract build:fast

# 4. 테스트
pnpm test
pnpm test:attacks
```

`contracts/managed/`는 빌드 산출물이므로 커밋하지 않는다. 테스트 실행 전에
반드시 3단계를 거쳐야 한다.
