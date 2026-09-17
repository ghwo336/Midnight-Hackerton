import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * WASM 런타임이 한 페이지에 두 인스턴스로 뜨지 않는지 본다.
 *
 * 같은 패키지가 두 버전으로 깔리면 각자 자기 WASM 모듈을 초기화한다.
 * 두 인스턴스는 상태를 공유하지 않으므로, 한쪽에서 만든 값을 다른 쪽이
 * 못 읽고 **오류 없이 조용히 틀린 결과**가 나온다. 이 프로젝트에서 이미
 * 두 번 겪었다.
 *
 *   1차  ledger-v8 이 8.1.0 과 8.1.2 로 깔려 타입이 어긋났다
 *   2차  onchain-runtime-v3 가 3.0.0 과 3.1.1 로 갈렸다
 *        compact-runtime@0.16.0 은 ^3.0.0, midnight-js-protocol@4.1.1 은
 *        정확히 3.0.0 을 요구해서 pnpm 이 둘 다 설치했다
 *
 * 둘 다 pnpm.overrides 로 고정해서 막았다. 이 테스트는 그 고정이 풀리는
 * 순간 실패한다.
 *
 * 설치된 node_modules 가 아니라 **락파일**을 읽는다. 락파일이 신선한
 * 클론에서 실제로 설치될 내용이고, 개발 기계에는 예전 설치의 고아
 * 디렉터리가 남아 거짓 양성을 만든다.
 */
const LOCKFILE = new URL('../../pnpm-lock.yaml', import.meta.url);

/**
 * WASM 을 품은 패키지. 두 버전이 공존하면 인스턴스가 갈린다.
 * 순수 JS 패키지는 중복돼도 상태를 공유할 일이 없으므로 제외한다.
 */
const WASM_PACKAGES = [
  '@midnight-ntwrk/onchain-runtime-v3',
  '@midnight-ntwrk/ledger-v8',
  '@midnight-ntwrk/zkir-v2',
  '@midnight-ntwrk/compact-runtime',
] as const;

async function installedVersions(): Promise<Map<string, Set<string>>> {
  const text = await readFile(LOCKFILE, 'utf8');
  const found = new Map<string, Set<string>>();
  // 락파일의 패키지 키: '@midnight-ntwrk/name@1.2.3':
  const pattern = /^\s{2}'(@midnight-ntwrk\/[^@']+)@([^'()]+)':/gm;
  for (const match of text.matchAll(pattern)) {
    const [, name, version] = match;
    if (name === undefined || version === undefined) continue;
    const set = found.get(name) ?? new Set<string>();
    set.add(version);
    found.set(name, set);
  }
  return found;
}

describe('Midnight 런타임 단일 인스턴스', () => {
  it('WASM 패키지가 각각 한 버전으로만 설치된다', async () => {
    const versions = await installedVersions();
    const split: string[] = [];
    for (const name of WASM_PACKAGES) {
      const set = versions.get(name);
      if (set && set.size > 1) {
        split.push(`${name}: ${[...set].sort().join(', ')}`);
      }
    }
    expect(
      split,
      `WASM 패키지가 여러 버전으로 갈렸다. pnpm.overrides 에 고정할 것:\n  ${split.join('\n  ')}`,
    ).toEqual([]);
  });

  it('락파일에 Midnight 패키지가 실제로 들어 있다', async () => {
    // 위 테스트가 파싱 실패로 조용히 통과하는 것을 막는다.
    const versions = await installedVersions();
    expect(versions.size).toBeGreaterThan(10);
    expect(versions.has('@midnight-ntwrk/onchain-runtime-v3')).toBe(true);
    expect(versions.has('@midnight-ntwrk/compact-runtime')).toBe(true);
  });

  it('고정한 버전이 overrides 와 일치한다', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { pnpm?: { overrides?: Record<string, string> } };
    const overrides = pkg.pnpm?.overrides ?? {};
    const versions = await installedVersions();

    for (const [name, pinned] of Object.entries(overrides)) {
      const set = versions.get(name);
      if (!set) continue;
      expect([...set], `${name} 이 override(${pinned}) 와 다르게 설치됐다`).toEqual([pinned]);
    }
  });
});
