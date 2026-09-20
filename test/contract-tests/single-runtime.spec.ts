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
 * 둘 다 overrides 로 고정해서 막았다. 이 테스트는 그 고정이 풀리는
 * 순간 실패한다.
 *
 * 고정이 사는 곳이 한 번 바뀌었다. pnpm 10 부터 package.json 의 "pnpm"
 * 필드를 읽지 않고 pnpm-workspace.yaml 을 본다. 옮기기 전까지는 경고 한
 * 줄만 나오고 고정이 조용히 풀려 있었는데, 락파일이 이미 고정된 상태로
 * 커밋돼 있어서 이 테스트는 통과했다. 그래서 지금은 세 곳이 서로 맞는지
 * 본다 — 설정(pnpm-workspace.yaml) · 락파일 · package.json 에 잔재 없음.
 *
 * 설치된 node_modules 가 아니라 **락파일**을 읽는다. 락파일이 신선한
 * 클론에서 실제로 설치될 내용이고, 개발 기계에는 예전 설치의 고아
 * 디렉터리가 남아 거짓 양성을 만든다.
 */
const LOCKFILE = new URL('../../pnpm-lock.yaml', import.meta.url);
const WORKSPACE = new URL('../../pnpm-workspace.yaml', import.meta.url);
const PACKAGE_JSON = new URL('../../package.json', import.meta.url);

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

/**
 * pnpm-workspace.yaml 의 overrides 블록을 읽는다.
 *
 * pnpm 10 부터 package.json 의 "pnpm" 필드를 읽지 않는다. 고정을 옮기지
 * 않으면 경고 한 줄만 나오고 조용히 풀린다. 그래서 이 테스트도 새 위치를
 * 본다.
 *
 * 락파일과 마찬가지로 정규식으로 읽는다. 대상이 두 줄이고, YAML 파서를
 * 들이면 그 파서 버전이 또 하나의 고정 대상이 된다.
 */
async function configuredOverrides(): Promise<Record<string, string>> {
  const text = await readFile(WORKSPACE, 'utf8');
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^overrides:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break; // 다음 최상위 키에서 끝난다
    const match = /^\s+'?([^':]+?)'?\s*:\s*'?([^'\s#]+)'?/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) out[match[1]] = match[2];
  }
  return out;
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
      `WASM 패키지가 여러 버전으로 갈렸다. pnpm-workspace.yaml 의 overrides 에 고정할 것:\n  ${split.join('\n  ')}`,
    ).toEqual([]);
  });

  it('락파일에 Midnight 패키지가 실제로 들어 있다', async () => {
    // 위 테스트가 파싱 실패로 조용히 통과하는 것을 막는다.
    const versions = await installedVersions();
    expect(versions.size).toBeGreaterThan(10);
    expect(versions.has('@midnight-ntwrk/onchain-runtime-v3')).toBe(true);
    expect(versions.has('@midnight-ntwrk/compact-runtime')).toBe(true);
  });

  it('고정한 버전이 pnpm-workspace.yaml 의 overrides 와 일치한다', async () => {
    const overrides = await configuredOverrides();

    /*
     * 파싱이 빈 객체를 돌려주면 아래 루프가 0회 돌아 조용히 통과한다.
     * 이 테스트가 막으려는 바로 그 형태의 거짓 통과라 먼저 막는다.
     */
    expect(
      Object.keys(overrides).sort(),
      'pnpm-workspace.yaml 의 overrides 블록을 읽지 못했다. 파서나 파일 형식을 볼 것',
    ).toEqual(['@midnight-ntwrk/ledger-v8', '@midnight-ntwrk/onchain-runtime-v3']);

    const versions = await installedVersions();
    for (const [name, pinned] of Object.entries(overrides)) {
      const set = versions.get(name);
      if (!set) continue;
      expect([...set], `${name} 이 override(${pinned}) 와 다르게 설치됐다`).toEqual([pinned]);
    }
  });

  it('pnpm 설정이 package.json 에 남아 있지 않다', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { pnpm?: unknown };
    expect(
      pkg.pnpm,
      'pnpm 10 은 package.json 의 "pnpm" 필드를 읽지 않는다 (경고만 내고 무시한다). ' +
        'pnpm-workspace.yaml 로 옮길 것',
    ).toBeUndefined();
  });

  it('락파일의 overrides 가 설정과 같다', async () => {
    /*
     * 설정만 고치고 pnpm install 을 안 돌리면 락파일에는 옛 고정이 남는다.
     * 실제로 설치되는 것은 락파일이므로, 둘이 갈라진 상태를 통과시키면 안 된다.
     */
    const text = await readFile(LOCKFILE, 'utf8');
    const block = /^overrides:\n((?:\s{2}.*\n)*)/m.exec(text)?.[1] ?? '';
    const locked: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const match = /^\s+'?([^':]+?)'?\s*:\s*(\S+)/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) locked[match[1]] = match[2];
    }
    expect(locked).toEqual(await configuredOverrides());
  });
});
