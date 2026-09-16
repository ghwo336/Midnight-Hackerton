import { describe, expect, it } from 'vitest';
import type { Hex } from '@once/domain';
import { computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import { ATTACKER_SECRET, buildScenario, invoiceAt } from '../fixtures/scenario.js';

/**
 * A8 — 발급자가 아닌 키로 발급자 권한 회로를 호출한다.
 * 기대: 거부.
 *
 * 발급 기관을 신뢰한다는 가정은 남지만(CONTEXT §6), 발급 기관을 사칭하는
 * 것은 막는다.
 */
describe('A8 — 발급자 아닌 키로 권한 회로 호출', () => {
  it('채권 등록이 거부된다', async () => {
    const sim = await buildScenario();
    const before = sim.snapshot().invoiceTreeSize;

    const forged = computeInvoiceLeaf({
      invoiceId: `0x${'ee'.repeat(32)}` as Hex,
      faceAmount: 999_000_000n,
      ownerPk: deriveOwnerPublicKey(ATTACKER_SECRET),
    });

    await expect(sim.registerInvoice(forged, ATTACKER_SECRET)).rejects.toThrow();
    expect(sim.snapshot().invoiceTreeSize).toBe(before);
  });

  it('금융사 등록이 거부된다', async () => {
    const sim = await buildScenario();
    const before = sim.snapshot().registeredLenders.length;
    await expect(
      sim.registerLender(`0x${'0c'.repeat(32)}` as Hex, ATTACKER_SECRET),
    ).rejects.toThrow();
    expect(sim.snapshot().registeredLenders).toHaveLength(before);
  });

  it('자금 예치가 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);
    expect(invoice).toBeDefined();
    const before = sim.snapshot().lenderVault.get(`0x${'0a'.repeat(32)}` as Hex);
    await expect(
      sim.fundLender(`0x${'0a'.repeat(32)}` as Hex, 500_000_000n, ATTACKER_SECRET),
    ).rejects.toThrow();
    expect(sim.snapshot().lenderVault.get(`0x${'0a'.repeat(32)}` as Hex)).toBe(before);
  });
});
