import { BadRequestException, Controller, Inject, Param, Post } from '@nestjs/common';
import { CIRCUIT_ASSERT, ServerCannotSignError } from '@once/domain';
import { ATTACK_IDS, RunAttackUseCase, type AttackId } from '../../application/run-attack.usecase.js';
import { SimulatorHolder } from '../../infrastructure/chain/simulator.holder.js';
import { DemoSeedService } from '../../infrastructure/chain/demo-seed.service.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ADDRESS, SUPPLIER_ID } from '../../config/demo.config.js';
import { isPreprodMode } from '../../infrastructure/chain/network.config.js';

/**
 * 데모 제어: 발표용이다. 제품 기능이 아니다.
 */
@Controller('demo')
export class DemoController {
  constructor(
    @Inject(RunAttackUseCase) private readonly runAttack: RunAttackUseCase,
    @Inject(SimulatorHolder) private readonly holder: SimulatorHolder,
    @Inject(DemoSeedService) private readonly seed: DemoSeedService,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
  ) {}

  /**
   * 공격 시나리오. **시뮬레이터 전용이다.**
   *
   * 실제 체인에서는 서버가 서명할 수 없다. 그대로 두면 모든 제출이
   * ServerCannotSignError 로 죽고, 공격 러너는 그걸 "막혔다" 로 센다.
   * 여섯 칸 전부 초록으로 뜨지만 **아무것도 시험되지 않았다.** 이 화면이
   * 가장 하면 안 되는 거짓말이라 경로 자체를 막는다.
   *
   * 실제 체인에서의 재현은 사용자 지갑이 서명해야 하므로 브라우저에서
   * 한다 (docs/TEST_REPORT.md).
   */
  @Post('attack/:id')
  async attack(@Param('id') id: string) {
    if (!(ATTACK_IDS as readonly string[]).includes(id)) {
      throw new BadRequestException({ code: 'UNKNOWN_ATTACK' });
    }
    if (isPreprodMode()) throw new ServerCannotSignError();
    const outcome = await this.runAttack.execute(id as AttackId, SUPPLIER_ID, SUPPLIER_ADDRESS);
    if (outcome.blocked) {
      this.events.publish({
        type: 'financing.rejected',
        reason: 'NULLIFIER_ALREADY_USED',
        lender: 'lender-b',
        circuitAssert: CIRCUIT_ASSERT['NULLIFIER_ALREADY_USED'],
      });
    }
    return outcome;
  }

  /**
   * 데모 초기화.
   *
   * 실제 체인에서는 원장을 되돌릴 수 없다. 되돌린 척하면 화면이 체인과
   * 다른 것을 보여준다. 그래서 거기서는 거부한다 — 지워지는 범위가
   * 사람이 기대하는 범위와 다르면 초기화라고 부를 수 없다.
   */
  @Post('reset')
  async reset() {
    if (isPreprodMode()) throw new ServerCannotSignError();
    await this.holder.reset();
    await this.seed.reseed();
    return { ok: true };
  }
}
