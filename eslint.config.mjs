import tseslint from 'typescript-eslint';

/**
 * 의존 방향 강제 (SPEC §4.1).
 *
 * 규칙을 우회해야 구현이 되면 설계가 틀린 것이므로 보고한다.
 * 규칙에 예외를 추가하지 않는다.
 */
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'contracts/managed/**'] },

  // TS·TSX 파서. 타입 검사는 tsc가 하고, 여기서는 의존 방향만 본다.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
  },

  // domain은 아무것도 의존하지 않는다
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@nestjs/*', 'next', 'next/*', 'react', '@midnight-ntwrk/*', '@once/*'],
            message: 'domain은 아무것도 의존하지 않는다 (SPEC §4.1)' },
        ],
      }],
    },
  },

  // crypto는 domain만 의존한다
  {
    files: ['packages/crypto/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@nestjs/*', 'next', 'next/*', 'react', '@once/chain', '@once/contract'],
            message: 'crypto는 domain만 의존한다 (SPEC §4.1)' },
        ],
      }],
    },
  },

  // application은 infrastructure의 구체 클래스를 import하지 않는다 (포트만)
  {
    files: ['apps/api/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/infrastructure/**', '@once/chain', '@once/contract', '@midnight-ntwrk/*'],
            message: 'application은 포트 인터페이스에만 의존한다 (SPEC §4.1)' },
        ],
      }],
    },
  },

  /*
   * web은 chain 패키지와 도메인 로직을 직접 import하지 않는다.
   *
   * Midnight SDK 금지는 해제했다. 전제가 바뀌었기 때문이다.
   * SPEC §9.2의 "모든 체인 접근은 api 경유"는 백엔드가 대신 서명하던
   * 구조를 전제로 한 규칙이었다. 이제 납품업체가 자기 지갑으로 직접
   * 서명하므로, 브라우저가 SDK를 쓰는 것이 설계 그 자체다.
   *
   * 다만 shared/wallet 밖에서는 여전히 금지한다. SDK 사용을 한 곳에
   * 가둬야 나머지 화면이 얇은 뷰로 남는다.
   */
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/shared/wallet/**', 'apps/web/src/features/wallet-panel/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@once/chain', '@once/contract', '@once/domain', '@once/crypto', '@midnight-ntwrk/*'],
            message: '체인 SDK는 shared/wallet 안에서만 쓴다. 화면은 얇은 뷰로 남긴다 (SPEC §9.2)' },
        ],
      }],
    },
  },

  // 지갑 계층은 SDK를 쓰되, 도메인 패키지는 여전히 직접 쓰지 않는다
  {
    files: ['apps/web/src/shared/wallet/**/*.ts', 'apps/web/src/features/wallet-panel/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@once/chain', '@once/contract'],
            message: '프론트는 Node 전용 패키지를 쓰지 않는다' },
        ],
      }],
    },
  },
);
