import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 실제 체인에서 **서버가 서명해야 하는 경로가 남아 있지 않은지** 본다.
 *
 * preprod 에서 서버에는 서명키가 없다. 그런 경로를 막지 않고 두면 요청이
 * 게이트웨이 깊은 곳에서 죽고, 화면은 "체인이 거부했다" 로 읽는다.
 * 실제로 발급 기관 화면이 그 상태였다 — finance 와 repay 만 브라우저
 * 경로로 옮겨져 있었고 채권 발행은 빠져 있었다.
 *
 * 체인에 쓰는 유스케이스를 부르는 POST 핸들러는 둘 중 하나여야 한다:
 *   - preprod 에서 `isPreprodMode()` 로 막혀 있다 (대체 경로가 따로 있다)
 *   - 애초에 체인에 쓰지 않는다
 *
 * 이 테스트는 소스를 읽는다. 런타임 동작이 아니라 **누락**을 잡는 것이
 * 목적이라, 새 라우트가 추가됐을 때 아무도 눈치채지 못하는 상황을 막는다.
 */
const CONTROLLER_DIR = new URL('../../apps/api/src/interface/http/', import.meta.url);

/** 체인에 쓰는 유스케이스. 이걸 부르는 핸들러는 preprod 에서 막혀야 한다. */
const CHAIN_WRITING = [
  'issueInvoice.execute',
  'requestFinancing.execute',
  'repayLoan.execute',
  'runAttack.execute',
  'seed.reseed',
] as const;

interface Handler {
  readonly file: string;
  readonly name: string;
  readonly body: string;
}

/** 컨트롤러에서 POST 핸들러 본문을 대충 잘라낸다. 중괄호 깊이로 센다. */
function postHandlers(source: string, file: string): Handler[] {
  const out: Handler[] = [];
  const marker = /@Post\(/g;
  let hit: RegExpExecArray | null;

  while ((hit = marker.exec(source)) !== null) {
    const rest = source.slice(hit.index);
    const open = rest.indexOf('{', rest.indexOf(')'));
    if (open < 0) continue;

    let depth = 0;
    let end = open;
    for (; end < rest.length; end += 1) {
      if (rest[end] === '{') depth += 1;
      else if (rest[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const header = rest.slice(0, open);
    const nameHit = /async\s+(\w+)\s*\(/.exec(header);
    out.push({
      file,
      name: nameHit?.[1] ?? '(이름 없음)',
      body: rest.slice(open, end + 1),
    });
  }
  return out;
}

function allHandlers(): Handler[] {
  const files = readdirSync(CONTROLLER_DIR).filter((f) => f.endsWith('.controller.ts'));
  return files.flatMap((file) =>
    postHandlers(readFileSync(new URL(file, CONTROLLER_DIR), 'utf8'), file),
  );
}

describe('preprod 쓰기 경로', () => {
  const handlers = allHandlers();

  it('컨트롤러를 실제로 읽었다', () => {
    // 정규식이 헛돌아 0건이면 아래 검사가 전부 무의미하게 통과한다.
    expect(handlers.length).toBeGreaterThan(8);
  });

  it('체인에 쓰는 POST 핸들러는 전부 preprod 에서 막혀 있다', () => {
    const unguarded = handlers
      .filter((h) => CHAIN_WRITING.some((call) => h.body.includes(call)))
      .filter((h) => !h.body.includes('isPreprodMode()'))
      .map((h) => `${h.file}:${h.name}`);

    expect(unguarded).toEqual([]);
  });

  /*
   * 막기만 하고 대체 경로를 안 만들면 그 화면은 실제 체인에서 못 쓴다.
   * 그래서 막힌 경로마다 **무엇이 대신하는지** 여기 적어 둔다. 새 경로를
   * 막으면서 이 표를 안 고치면 테스트가 걸린다 — 대체 수단을 정하지 않은
   * 채로 화면 하나가 조용히 죽는 일을 막는다.
   */
  const REPLACEMENTS: Readonly<Record<string, readonly string[]>> = {
    // 신청: 사전 검사와 회로 입력을 받아 브라우저가 서명한다
    'supplier.controller.ts:financing': ['financing/prepare', 'financing/confirm'],
    /*
     * 상환: prepare 가 없다. 회로가 쓰는 값이 (nullifier, amount) 뿐이고
     * 둘 다 GET /supplier/funds 로 이미 나가므로 따로 받을 게 없다.
     * 확정만 대조한다.
     */
    'supplier.controller.ts:repay': ['repay/confirm'],
    // 발급: 서버가 리프를 계산해 건네고 브라우저가 지갑으로 올린다
    'issuer.controller.ts:invoices': ['invoices/prepare', 'invoices/confirm'],
    'issuer.controller.ts:requests/approve': [
      'requests/approve/prepare', 'invoices/confirm',
    ],
    /*
     * 공격 러너와 데모 초기화에는 대체 HTTP 경로가 없다. 의도한 바다.
     * 러너는 /devtools 의 브라우저 재현기가 대신하고, 초기화는 실제
     * 체인에서 되돌릴 수 없으므로 대신할 것이 없다.
     */
    'demo.controller.ts:attack/:id': [],
    'demo.controller.ts:reset': [],
  };

  it('막힌 경로마다 무엇이 대신하는지 정해져 있다', () => {
    const routesOf = (file: string) => {
      const source = readFileSync(new URL(file, CONTROLLER_DIR), 'utf8');
      return [...source.matchAll(/@Post\('([^']+)'\)/g)].map((m) => m[1] as string);
    };

    const guarded = handlers
      .filter((h) => h.body.includes('isPreprodMode()'))
      .map((h) => {
        const source = readFileSync(new URL(h.file, CONTROLLER_DIR), 'utf8');
        const at = source.indexOf(h.body);
        const before = source.slice(0, at);
        const route = [...before.matchAll(/@Post\('([^']+)'\)/g)].at(-1)?.[1];
        return `${h.file}:${route ?? '?'}`;
      });

    // 막힌 경로가 표에 다 있는가 (새로 막았는데 대체 수단을 안 정했는가)
    expect(guarded.filter((key) => !(key in REPLACEMENTS))).toEqual([]);

    // 표가 가리키는 경로가 실제로 있는가 (지워졌는데 표만 남았는가)
    for (const [key, replacements] of Object.entries(REPLACEMENTS)) {
      const file = key.slice(0, key.indexOf(':'));
      const routes = routesOf(file);
      for (const route of replacements) {
        expect(routes, `${key} 의 대체 경로`).toContain(route);
      }
    }
  });
});
