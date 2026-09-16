import { Inject, Injectable } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';
import { deriveIssuerPublicKey } from '@once/crypto';
import { LENDER_FUNDING, LENDER_KEYS, loadEnv } from '../../config/demo.config.js';

/**
 * 시뮬레이터를 교체 가능하게 감싼다.
 *
 * 발표 중에 데모를 처음부터 다시 돌릴 수 있어야 해서, 원장 전체를
 * 초기 상태로 되돌리는 경로가 필요하다. 체인 자체를 리셋하는 것은
 * 데모 편의 기능이며 제품 기능이 아니다.
 */
@Injectable()
export class SimulatorHolder {
  constructor(@Inject(OnceContractSimulator) private simulator: OnceContractSimulator) {}

  get current(): OnceContractSimulator {
    return this.simulator;
  }

  static async build(): Promise<OnceContractSimulator> {
    const env = loadEnv();
    const sim = await OnceContractSimulator.create({
      issuerId: env.ISSUER_ID as `0x${string}`,
      issuerSecret: env.ISSUER_SECRET_KEY as `0x${string}`,
      issuerPk: deriveIssuerPublicKey(env.ISSUER_SECRET_KEY as `0x${string}`),
      ltvBps: env.LTV_BPS,
    });
    for (const key of Object.values(LENDER_KEYS)) {
      await sim.registerLender(key);
      await sim.fundLender(key, LENDER_FUNDING);
    }
    return sim;
  }

  async reset(): Promise<void> {
    this.simulator = await SimulatorHolder.build();
  }
}
