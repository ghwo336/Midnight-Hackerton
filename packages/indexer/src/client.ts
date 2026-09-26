import type { Hex } from '@once/domain';
import type { ChainTip } from './types.js';
import type { ContractAction } from './types.js';

/**
 * Midnight 인덱서 클라이언트.
 *
 * Node 와 브라우저에서 같은 코드가 돈다. fetch 는 양쪽에 있고, WebSocket 은
 * 브라우저에 전역으로 있으며 Node 에서는 생성자를 주입받는다. 사본을 두면
 * 갈라지므로 하나로 쓴다.
 */
export interface IndexerConfig {
  /** GraphQL HTTP 엔드포인트. */
  readonly httpUrl: string;
  /** GraphQL WebSocket 엔드포인트. 액션 구독에 쓴다. */
  readonly wsUrl: string;
  /**
   * WebSocket 생성자. 브라우저면 생략(전역 사용), Node 면 'ws' 를 넘긴다.
   * 타입을 느슨하게 둔 것은 두 환경의 WebSocket 타입이 다르기 때문이다.
   */
  readonly webSocket?: new (url: string, protocol?: string) => unknown;
  readonly fetchFn?: typeof fetch;
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const KIND: Record<string, ContractAction['kind']> = {
  ContractDeploy: 'deploy',
  ContractCall: 'call',
  ContractUpdate: 'update',
};

export class IndexerClient {
  constructor(private readonly config: IndexerConfig) {}

  private get fetchFn(): typeof fetch {
    return this.config.fetchFn ?? fetch;
  }

  async query<T>(query: string): Promise<T> {
    const response = await this.fetchFn(this.config.httpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      throw new Error(`인덱서 응답 ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (body.errors) {
      throw new Error(`인덱서 오류: ${JSON.stringify(body.errors).slice(0, 300)}`);
    }
    if (!body.data) throw new Error('인덱서가 data 없이 응답했다');
    return body.data;
  }

  async tip(): Promise<ChainTip> {
    const data = await this.query<{ block: { height: number; timestamp: number } }>(
      '{ block { height timestamp } }',
    );
    return { height: data.block.height, timestamp: data.block.timestamp };
  }

  /**
   * 컨트랙트의 **최신** 액션과 그 시점 상태.
   *
   * 화면이 필요한 원장 값(금고·리프·nullifier·대출)은 전부 최신 상태 하나에
   * 들어 있다. 이력이 필요한 것은 tx 해시를 붙일 때뿐이다.
   */
  async latestAction(address: Hex): Promise<ContractAction | null> {
    const data = await this.query<{
      contractAction: null | {
        __typename: string;
        state: string;
        transaction: { hash: string; block: { height: number; timestamp: number } };
      };
    }>(
      `{ contractAction(address: "${address}") {
           __typename state transaction { hash block { height timestamp } } } }`,
    );
    const action = data.contractAction;
    if (!action) return null;
    return {
      kind: KIND[action.__typename] ?? 'call',
      txHash: `0x${action.transaction.hash}` as Hex,
      block: action.transaction.block.height,
      timestamp: action.transaction.block.timestamp,
      state: hexToBytes(action.state),
    };
  }

  /**
   * 배포 블록부터 현재까지의 액션을 모두 받는다.
   *
   * blockOffset 은 **정확한 높이**를 요구해서 폴링으로는 이력을 걸을 수 없다
   * (없는 높이를 주면 null 이 온다). 구독은 그 높이 이후 전부를 흘려보낸다.
   *
   * 스트림은 과거를 다 보낸 뒤에도 열려 있으므로 끝을 알 수 없다. 그래서
   * 컨트랙트의 **최신 액션 블록**을 HTTP 로 먼저 읽어 두고, 그 블록의 액션을
   * 받으면 닫는다. 거기 닿기 전에 끊기면 **오류다.**
   *
   * 예전에는 "1.5초 조용하면 끝" 이었다. 인덱서는 첫 액션을 주기 전에
   * 배포 블록부터 훑느라 몇 초씩 조용하다. 그 사이에 닫혀 0건을 성공으로
   * 돌려줬고, 대출의 블록·tx 가 전부 null 로 남았다. 모자란 이력을 완전한
   * 것처럼 돌려주지 않는다.
   */
  async actionsSince(
    address: Hex,
    fromBlock: number,
    options: { readonly idleMs?: number; readonly timeoutMs?: number } = {},
  ): Promise<readonly ContractAction[]> {
    const Socket = this.config.webSocket ?? (globalThis as { WebSocket?: unknown }).WebSocket;
    if (!Socket) throw new Error('WebSocket 구현이 없다. Node 에서는 config.webSocket 을 넘길 것');

    const idleMs = options.idleMs ?? 15_000;
    const timeoutMs = options.timeoutMs ?? 90_000;
    const latest = await this.latestAction(address);
    if (!latest) return [];
    const targetHeight = latest.block;

    return new Promise<readonly ContractAction[]>((resolve, reject) => {
      const collected: ContractAction[] = [];
      const Ctor = Socket as new (url: string, protocol?: string) => {
        send(data: string): void;
        close(): void;
        addEventListener?(type: string, fn: (event: unknown) => void): void;
        on?(type: string, fn: (event: unknown) => void): void;
      };
      const socket = new Ctor(this.config.wsUrl, 'graphql-transport-ws');

      let idle: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(idle);
        clearTimeout(hard);
        try {
          socket.close();
        } catch {
          // 이미 닫혔으면 신경 쓰지 않는다
        }
        if (error) reject(error);
        else resolve(collected);
      };
      const short = (why: string) =>
        finish(
          new Error(
            `인덱서 이력이 블록 ${targetHeight} 에 닿기 전에 ${why} ` +
              `(받은 액션 ${collected.length}건, 마지막 블록 ${collected.at(-1)?.block ?? '없음'})`,
          ),
        );
      const hard = setTimeout(() => short(`${timeoutMs}ms 제한에 걸렸다`), timeoutMs);
      const bump = () => {
        clearTimeout(idle);
        idle = setTimeout(() => short(`${idleMs}ms 동안 조용했다`), idleMs);
      };

      // ws 는 on(), 브라우저는 addEventListener() 를 쓴다.
      const listen = (type: string, fn: (payload: unknown) => void) => {
        if (socket.on) socket.on(type, fn);
        else socket.addEventListener?.(type, fn);
      };

      listen('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
      listen('error', () => finish(new Error('인덱서 WebSocket 오류')));
      listen('close', () => short('소켓이 닫혔다'));
      listen('message', (event: unknown) => {
        const raw =
          typeof event === 'object' && event !== null && 'data' in event
            ? String((event as { data: unknown }).data)
            : String(event);
        let message: {
          type?: string;
          payload?: { data?: { contractActions?: Record<string, unknown> } };
        };
        try {
          message = JSON.parse(raw) as typeof message;
        } catch {
          return;
        }

        if (message.type === 'connection_ack') {
          socket.send(
            JSON.stringify({
              id: '1',
              type: 'subscribe',
              payload: {
                query: `subscription { contractActions(address: "${address}", offset: {height: ${fromBlock}}) {
                  __typename state transaction { hash block { height timestamp } } } }`,
              },
            }),
          );
          // 첫 액션 전의 침묵은 인덱서가 훑는 시간이다. 여기선 idle 을 걸지
          // 않고 전체 제한 시간만 믿는다.
          return;
        }

        if (message.type === 'next') {
          const action = message.payload?.data?.contractActions as
            | {
                __typename: string;
                state: string;
                transaction: { hash: string; block: { height: number; timestamp: number } };
              }
            | undefined;
          if (action) {
            collected.push({
              kind: KIND[action.__typename] ?? 'call',
              txHash: `0x${action.transaction.hash}` as Hex,
              block: action.transaction.block.height,
              timestamp: action.transaction.block.timestamp,
              state: hexToBytes(action.state),
            });
            // 최신 액션까지 받았으면 과거를 다 받은 것이다.
            if (action.transaction.block.height >= targetHeight) {
              finish();
              return;
            }
          }
          bump();
          return;
        }

        if (message.type === 'error') finish(new Error('인덱서 구독 오류'));
        else if (message.type === 'complete') short('구독이 끝났다');
      });
    });
  }
}
