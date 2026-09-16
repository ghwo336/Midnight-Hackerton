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

  // web은 chain이나 Midnight SDK를 직접 import하지 않는다
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@once/chain', '@once/contract', '@once/domain', '@once/crypto', '@midnight-ntwrk/*'],
            message: '모든 체인 접근은 api 경유다. 프론트에 도메인 로직을 두지 않는다 (SPEC §9.2)' },
        ],
      }],
    },
  },
);
