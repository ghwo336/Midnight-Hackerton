import { describe, expect, it } from 'vitest';
import { ServerCannotSignError, type Hex } from '@once/domain';
import { MidnightChainGateway } from '../../apps/api/src/infrastructure/chain/midnight.gateway.js';
import { loadPreprodConfig } from '../../apps/api/src/infrastructure/chain/network.config.js';
import { chainReaderContract } from './chain-gateway.spec.js';

/**
 * **같은 읽기 계약을 실제 체인에 돌린다** (LSP, SPEC §5).
 *
 * 시뮬레이터가 통과하는 스위트를 MidnightChainGateway 가 그대로 통과해야
 * 한다. 통과하지 못하면 유스케이스를 고치는 게 아니라 구현을 고친다.
 * 두 구현이 같은 질문에 다르게 답하면, 화면은 어느 모드로 도는지에 따라
 * 다른 것을 주장하게 된다.
 *
 * 네트워크와 배포된 컨트랙트가 필요하므로 옵트인이다:
 *
 *   ONCE_LIVE_CHAIN=1 CHAIN_MODE=preprod \
 *   CONTRACT_ADDRESS=… DEPLOY_BLOCK=… pnpm vitest run test/contract-tests/live-chain.spec.ts
 *
 * 심사용 기본 경로(local-circuit)는 이 파일을 건너뛴다. 네트워크가 없는
 * 곳에서 테스트가 빨간불이 되면 안 된다.
 */
const LIVE = process.env['ONCE_LIVE_CHAIN'] === '1';

/*
 * 리프 검사가 기대하는 채권은 배포된 데모 채권 #1 이다.
 * (0xa1…, 100_000_000, ownerPk(0x7c…)) — apps/deploy/deployment.json 참조.
 */
/*
 * WebSocket 구현을 넘기지 않는다. Node 22 부터 전역에 있고, IndexerClient 는
 * 없을 때만 전역을 쓴다. `ws` 는 apps/api 의 의존성이라 저장소 루트에서
 * 해석되지 않는다.
 */
function liveGateway(): MidnightChainGateway {
  return new MidnightChainGateway(loadPreprodConfig());
}

if (LIVE) {
  chainReaderContract('MidnightChainGateway (preprod)', async () => {
    const gateway = liveGateway();
    await gateway.onModuleInit();
    return gateway;
  });

  describe('MidnightChainGateway: 서버는 서명하지 않는다', () => {
    /*
     * 쓰기 계약을 통과하지 못하는 것이 **정상이다.**
     *
     * 실제 네트워크에서 서버가 서명할 수 있다면 사용자 자산을 서버가
     * 움직일 수 있다는 뜻이다. 그래서 세 경로 모두 한결같이 거부한다.
     * 조용히 시뮬레이터로 넘어가면 화면이 체인에 없는 일을 있었던 것처럼
     * 보여준다 — 그게 이 검사가 막는 것이다.
     */
    const witness = {
      invoiceId: `0x${'a1'.repeat(32)}` as Hex,
      faceAmount: 100_000_000n,
      salt: `0x${'d1'.repeat(32)}` as Hex,
      ownerSecret: `0x${'7c'.repeat(32)}` as Hex,
    };

    it('대출 제출을 거부한다', async () => {
      await expect(
        liveGateway().submitFinancing({
          lender: 'lender-a', amount: 80_000_000n,
          recipient: `0x${'cc'.repeat(32)}` as Hex, witness,
        }),
      ).rejects.toBeInstanceOf(ServerCannotSignError);
    });

    it('상환 제출을 거부한다', async () => {
      await expect(
        liveGateway().submitRepayment({
          nullifier: `0x${'11'.repeat(32)}` as Hex, amount: 1n,
        }),
      ).rejects.toBeInstanceOf(ServerCannotSignError);
    });

    it('채권 리프 등록을 거부한다', async () => {
      await expect(
        liveGateway().registerInvoiceLeaf(`0x${'22'.repeat(32)}` as Hex),
      ).rejects.toBeInstanceOf(ServerCannotSignError);
    });
  });
} else {
  describe('실제 체인 계약 테스트', () => {
    it.skip('ONCE_LIVE_CHAIN=1 일 때만 돈다', () => undefined);
  });
}
