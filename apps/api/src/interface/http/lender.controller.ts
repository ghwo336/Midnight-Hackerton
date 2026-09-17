import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { CHECK_ASSERT, CHECK_LABEL, REVIEW_CHECKS, isLenderId } from '@once/domain';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import {
  APPLICATION_LOG_READER, type ApplicationLogReader,
} from '../../application/ports/application-log.js';
import { LENDER_LABELS } from '../../config/demo.config.js';

/**
 * 여신 심사 화면용.
 *
 * 이 컨트롤러는 PrivateStateRepository를 주입받지 않는다. 금융사 세션이
 * 납품업체 채권 원문에 닿는 경로가 코드에 존재하지 않게 하기 위해서다
 * (SPEC §3.1). 주입 목록에 그걸 추가하면 원문이 나갈 수 있게 되므로
 * 아키텍처 테스트가 이 파일의 의존성을 검사한다.
 *
 * 응답에 담기는 것:
 *   - 내 예치 잔액과 내가 실행한 대출
 *   - 나에게 온 신청과 그 검증 결과 네 줄
 * 담기지 않는 것:
 *   - 채권 원문 (구매기업·액면·지급일·승인번호)
 *   - 다른 금융사의 잔액·대출·신청
 */
@Controller('lender')
export class LenderController {
  constructor(
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(APPLICATION_LOG_READER) private readonly applications: ApplicationLogReader,
  ) {}

  /**
   * 심사 기준. 화면이 체크리스트 라벨과 회로 표현식을 지어내지 않도록
   * 백엔드가 내려준다. 회로가 바뀌면 화면도 따라 바뀐다.
   */
  @Get('checks')
  checks() {
    return {
      checks: REVIEW_CHECKS.map((check) => ({
        key: check,
        label: CHECK_LABEL[check],
        assert: CHECK_ASSERT[check],
      })),
    };
  }

  @Get(':lenderId')
  async state(@Param('lenderId') lenderId: string) {
    if (!isLenderId(lenderId)) throw new NotFoundException({ code: 'LENDER_NOT_FOUND' });

    const loans = await this.reader.listLoans();
    return {
      lenderId,
      label: LENDER_LABELS[lenderId],
      vault: (await this.reader.getLenderVault(lenderId)).toString(),
      ltvBps: (await this.reader.getLtvBps()).toString(),
      loans: loans.filter((loan) => loan.lender === lenderId),
      applications: await this.applications.listFor(lenderId),
    };
  }
}
