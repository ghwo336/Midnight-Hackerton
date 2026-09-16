import { BadRequestException, Controller, Inject, Param, Post } from '@nestjs/common';
import { ATTACK_IDS, RunAttackUseCase, type AttackId } from '../../application/run-attack.usecase.js';
import { SimulatorHolder } from '../../infrastructure/chain/simulator.holder.js';
import { DemoSeedService } from '../../infrastructure/chain/demo-seed.service.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ADDRESS, SUPPLIER_ID } from '../../config/demo.config.js';

/**
 * 데모 제어 — 발표용이다. 제품 기능이 아니다.
 */
@Controller('demo')
export class DemoController {
  constructor(
    @Inject(RunAttackUseCase) private readonly runAttack: RunAttackUseCase,
    @Inject(SimulatorHolder) private readonly holder: SimulatorHolder,
    @Inject(DemoSeedService) private readonly seed: DemoSeedService,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
  ) {}

  @Post('attack/:id')
  async attack(@Param('id') id: string) {
    if (!(ATTACK_IDS as readonly string[]).includes(id)) {
      throw new BadRequestException({ code: 'UNKNOWN_ATTACK' });
    }
    const outcome = await this.runAttack.execute(id as AttackId, SUPPLIER_ID, SUPPLIER_ADDRESS);
    if (outcome.blocked) {
      this.events.publish({ type: 'financing.rejected', reason: 'NULLIFIER_ALREADY_USED', lender: 'lender-b' });
    }
    return outcome;
  }

  @Post('reset')
  async reset() {
    await this.holder.reset();
    await this.seed.reseed();
    return { ok: true };
  }
}
