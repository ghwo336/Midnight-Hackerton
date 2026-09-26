import { describe, expect, it } from 'vitest';
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { IndexerClient } from '@once/indexer';
import {
  ConfirmFinancingSchema, ConfirmIssuanceSchema, ConfirmRepaySchema,
} from '../src/interface/http/dto/schemas.js';
import { DomainExceptionFilter } from '../src/common/errors/domain-exception.filter.js';

/**
 * 실제 체인의 확정 보고가 서버에 닿는 경로를 고정한다.
 *
 * 세 가지가 겹쳐서 A6 한 번에 금융사 화면이 조용히 틀렸다.
 *   1. 지갑 SDK 는 tx 해시가 아니라 식별자(33바이트, 0x 없음)를 준다.
 *      스키마가 해시만 받아 확정 보고가 전부 검증에서 떨어졌다.
 *   2. 그 검증 실패가 400 이 아니라 500 INTERNAL_ERROR 로 나가 원인이
 *      안 보였다.
 *   3. 인덱서 이력이 1.5초 조용하면 0건을 성공으로 돌려줘 대출의
 *      블록·tx 가 null 로 남았다.
 */

// Preprod 블록 2713307 의 실제 값 (인덱서 조회).
const IDENTIFIER = '0079894ae7e5c07d084fb96f1a131fd0ec1e65c353a0ec628698929c793f580999';
const HASH = 'aac1ece4385c86859470556cdcd71f6b73df90661eb9e86639ec4e95bda46863';
const HEX32 = `0x${'00'.repeat(32)}`;

const financing = (txHash: unknown) => ({
  applicationId: 'app-00000001',
  invoiceId: HEX32,
  lenderId: 'lender-a',
  amount: '80000000',
  nullifier: HEX32,
  receivedAt: '2026-09-26T04:38:00Z',
  elapsedMs: 33_900,
  outcome: 'settled',
  txHash,
  block: 2713307,
});

describe('확정 보고의 txHash', () => {
  it('지갑이 주는 식별자를 받고 0x 를 붙인다', () => {
    const parsed = ConfirmFinancingSchema.parse(financing(IDENTIFIER));
    expect(parsed.txHash).toBe(`0x${IDENTIFIER}`);
  });

  it('해시도 받는다 (0x 유무 무관, 소문자로 정규화)', () => {
    expect(ConfirmFinancingSchema.parse(financing(HASH)).txHash).toBe(`0x${HASH}`);
    expect(ConfirmFinancingSchema.parse(financing(`0x${HASH.toUpperCase()}`)).txHash).toBe(`0x${HASH}`);
  });

  it('길이가 맞지 않거나 16진수가 아니면 거부한다', () => {
    expect(ConfirmFinancingSchema.safeParse(financing(HASH.slice(2))).success).toBe(false);
    expect(ConfirmFinancingSchema.safeParse(financing(`${IDENTIFIER}00`)).success).toBe(false);
    expect(ConfirmFinancingSchema.safeParse(financing(`zz${HASH.slice(2)}`)).success).toBe(false);
  });

  it('상환·발급 보고도 같은 형식을 받는다', () => {
    expect(ConfirmRepaySchema.parse({ nullifier: HEX32, txHash: IDENTIFIER, block: 1 }).txHash)
      .toBe(`0x${IDENTIFIER}`);
    expect(ConfirmIssuanceSchema.parse({ issuanceId: 'iss-00000001', txHash: IDENTIFIER, block: 1 }).txHash)
      .toBe(`0x${IDENTIFIER}`);
  });
});

describe('예외 필터', () => {
  const run = (exception: unknown) => {
    let status = 0;
    let body: unknown;
    const response = {
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; return this; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    new DomainExceptionFilter().catch(exception, host as never);
    return { status, body };
  };

  it('검증 실패는 400 과 필드 목록으로 나간다', () => {
    const r = run(new BadRequestException({ code: 'VALIDATION_FAILED', fields: ['txHash'] }));
    expect(r.status).toBe(HttpStatus.BAD_REQUEST);
    expect(r.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['txHash'] });
  });

  it('없는 라우트는 404 다', () => {
    const r = run(new NotFoundException('Cannot GET /public/loans'));
    expect(r.status).toBe(HttpStatus.NOT_FOUND);
    expect(r.body).toEqual({ code: 'NOT_FOUND' });
  });

  it('알 수 없는 오류는 여전히 500 이고 원문을 내보내지 않는다', () => {
    const r = run(new Error('secret stack detail'));
    expect(r.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});

/**
 * 인덱서 구독을 흉내 낸다. 액션을 보내기 전에 `delayMs` 동안 조용하다.
 * 실제 Preprod 인덱서가 배포 블록부터 훑는 동안 그렇다 (측정: 수 초).
 */
function fakeIndexer(blocks: readonly number[], delayMs: number, latest: number) {
  const fetchFn = (async () =>
    new Response(
      JSON.stringify({
        data: {
          contractAction: {
            __typename: 'ContractCall',
            state: '00',
            transaction: { hash: 'ab'.repeat(32), block: { height: latest, timestamp: 0 } },
          },
        },
      }),
    )) as typeof fetch;

  class FakeSocket {
    private readonly handlers = new Map<string, (event: unknown) => void>();
    constructor() {
      setTimeout(() => this.emit('open', {}), 0);
    }
    on(type: string, fn: (event: unknown) => void) {
      this.handlers.set(type, fn);
    }
    send(raw: string) {
      const message = JSON.parse(raw) as { type: string };
      if (message.type === 'connection_init') {
        setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'connection_ack' }) }), 0);
      }
      if (message.type === 'subscribe') {
        blocks.forEach((height, i) =>
          setTimeout(
            () =>
              this.emit('message', {
                data: JSON.stringify({
                  type: 'next',
                  payload: {
                    data: {
                      contractActions: {
                        __typename: 'ContractCall',
                        state: '00',
                        transaction: { hash: 'cd'.repeat(32), block: { height, timestamp: 0 } },
                      },
                    },
                  },
                }),
              }),
            delayMs + i,
          ),
        );
      }
    }
    close() {
      this.emit('close', {});
    }
    private emit(type: string, event: unknown) {
      this.handlers.get(type)?.(event);
    }
  }

  return new IndexerClient({
    httpUrl: 'http://indexer.invalid',
    wsUrl: 'ws://indexer.invalid',
    fetchFn,
    webSocket: FakeSocket as never,
  });
}

describe('인덱서 이력 걷기', () => {
  const address = `0x${'52'.repeat(32)}` as const;

  it('첫 액션 전에 조용해도 최신 액션까지 다 받는다', async () => {
    // 첫 액션까지 idle 보다 길게 조용하다. 예전 구현은 여기서 0건을 돌려줬다.
    const client = fakeIndexer([100, 150, 200], 500, 200);
    const actions = await client.actionsSince(address, 100, { idleMs: 200, timeoutMs: 5_000 });
    expect(actions.map((a) => a.block)).toEqual([100, 150, 200]);
  });

  it('최신 액션에 닿기 전에 끊기면 0건을 성공으로 돌려주지 않는다', async () => {
    const client = fakeIndexer([100, 150], 0, 200);
    await expect(
      client.actionsSince(address, 100, { idleMs: 200, timeoutMs: 5_000 }),
    ).rejects.toThrow(/블록 200 에 닿기 전에/);
  });

  it('전체 제한 시간을 넘기면 오류다', async () => {
    const client = fakeIndexer([100, 200], 1_000, 200);
    await expect(
      client.actionsSince(address, 100, { idleMs: 5_000, timeoutMs: 200 }),
    ).rejects.toThrow(/200ms 제한/);
  });
});
