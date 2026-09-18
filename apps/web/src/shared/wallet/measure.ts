'use client';

/**
 * 실측 기록기.
 *
 * S6-b와 S6-c를 닫으려면 "빨랐다 / 잘 됐다"가 아니라 숫자와 호출 기록이
 * 필요하다. 추정치를 만들지 않기 위해, 측정하지 못한 구간은 기록에
 * 나타나지 않게 둔다. 빈 칸은 빈 칸으로 보고한다.
 */
export interface Phase {
  readonly step: string;
  readonly phase: string;
  readonly ms: number;
  readonly bytes?: number;
}

/** witness가 실제로 불렸는지. S6-c의 증거다. */
export interface WitnessCall {
  readonly step: string;
  readonly witness: string;
  readonly at: number;
}

export class Recorder {
  readonly phases: Phase[] = [];
  readonly witnessCalls: WitnessCall[] = [];
  /** IndexedDB private state 저장소가 읽힌 횟수. */
  privateStateReads = 0;
  private step = 'init';

  setStep(step: string): void {
    this.step = step;
  }

  /** 구간 하나를 재고 결과를 그대로 돌려준다. */
  async time<T>(phase: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      this.phases.push({ step: this.step, phase, ms: performance.now() - started });
    }
  }

  note(phase: string, ms: number, bytes?: number): void {
    this.phases.push({ step: this.step, phase, ms, ...(bytes === undefined ? {} : { bytes }) });
  }

  /** 실패한 ZK 자산 요청. 무엇이 안 됐는지 화면에 그대로 적기 위해 남긴다. */
  readonly fetchFailures: { url: string; reason: string }[] = [];

  fetchFailed(url: string, reason: string): void {
    this.fetchFailures.push({ url, reason });
  }

  witnessFired(witness: string): void {
    this.witnessCalls.push({ step: this.step, witness, at: performance.now() });
  }

  /** 한 단계의 구간 합계. */
  totalFor(step: string, phase: string): number | null {
    const hit = this.phases.filter((p) => p.step === step && p.phase === phase);
    return hit.length === 0 ? null : hit.reduce((acc, p) => acc + p.ms, 0);
  }

  /** 보고서에 그대로 붙일 수 있는 형태. */
  toReport(): string {
    const lines = ['step\tphase\tms\tbytes'];
    for (const p of this.phases) {
      lines.push(`${p.step}\t${p.phase}\t${p.ms.toFixed(1)}\t${p.bytes ?? ''}`);
    }
    lines.push('', `privateStateReads\t${this.privateStateReads}`);
    for (const failure of this.fetchFailures) {
      lines.push(`fetchFailed\t${failure.url}\t${failure.reason}`);
    }
    for (const call of this.witnessCalls) {
      lines.push(`witness\t${call.step}\t${call.witness}`);
    }
    return lines.join('\n');
  }
}
