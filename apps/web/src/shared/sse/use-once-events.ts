export type FinancingStage =
  | 'witness' | 'proving' | 'submitting' | 'settled' | 'rejected';

export type OnceEvent =
  | { type: 'invoice.issued'; invoiceId: string }
  | {
      type: 'financing.stage';
      lender: string;
      stage: FinancingStage;
      at: string;
      elapsedMs: number;
      block?: number;
      reason?: string;
      circuitAssert?: string | null;
    }
  | {
      type: 'financing.settled';
      nullifier: string; lender: string; amount: string; txHash: string; block: number;
    }
  | {
      type: 'financing.rejected';
      reason: string;
      lender: string;
      circuitAssert?: string | null;
    };
