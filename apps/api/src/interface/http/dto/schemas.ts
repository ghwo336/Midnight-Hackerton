import { z } from 'zod';

/**
 * 컨트롤러 입력은 전량 검증한다 (SPEC §8.5).
 * 금액은 문자열로 받아 bigint로 변환한다. number를 거치지 않는다.
 */
export const hex32Schema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const RequestFinancingSchema = z.object({
  invoiceId: hex32Schema,
  lenderId: z.enum(['lender-a', 'lender-b']),
  amount: z.string().regex(/^\d+$/).transform(BigInt),
  /**
   * 이 금융사에 내줄 위험 정보 항목. 생략하면 아무것도 내주지 않는다.
   * 구매기업명·승인번호는 여기 들어올 수 없다. enum 이 막는다.
   */
  disclose: z.array(z.enum(['creditGrade', 'dueWindow', 'industry'])).default([]),
});

export type RequestFinancingDto = z.infer<typeof RequestFinancingSchema>;

/**
 * 브라우저가 회로를 돌린 결과 보고.
 *
 * 서버는 이 값을 그대로 믿지 않는다. 기록하기 전에 원장을 읽어 대조한다
 * (ConfirmFinancingUseCase). 그래서 여기서는 형식만 본다.
 */
export const ConfirmFinancingSchema = z.object({
  applicationId: z.string().min(8).max(64),
  invoiceId: hex32Schema,
  lenderId: z.enum(['lender-a', 'lender-b']),
  amount: z.string().regex(/^\d+$/).transform(BigInt),
  nullifier: hex32Schema,
  receivedAt: z.string().min(8).max(40),
  elapsedMs: z.number().int().nonnegative().max(3_600_000),
  disclose: z.array(z.enum(['creditGrade', 'dueWindow', 'industry'])).default([]),
  outcome: z.enum(['settled', 'rejected']),
  txHash: hex32Schema.nullable().default(null),
  block: z.number().int().nonnegative().nullable().default(null),
  reason: z.string().max(60).nullable().default(null),
});

export type ConfirmFinancingDto = z.infer<typeof ConfirmFinancingSchema>;

/** 상환 보고. 원장에서 repaid 로 확인한다. */
export const ConfirmRepaySchema = z.object({
  nullifier: hex32Schema,
  txHash: hex32Schema.nullable().default(null),
  block: z.number().int().nonnegative().nullable().default(null),
});
export type ConfirmRepayDto = z.infer<typeof ConfirmRepaySchema>;

export const IssueInvoiceSchema = z.object({
  faceAmount: z.string().regex(/^\d+$/).transform(BigInt),
  counterparty: z.string().min(1).max(120),
  dueDate: z.string().min(1).max(40),
  approvalNumber: z.string().min(1).max(60),
  memo: z.string().max(200).default(''),
  creditGrade: z.string().min(1).max(8).default('BBB'),
  dueWindow: z.string().min(1).max(20).default('60~90일'),
  industry: z.string().min(1).max(40).default('기타'),
});

export type IssueInvoiceDto = z.infer<typeof IssueInvoiceSchema>;

/** 역할 claim. 주소 형식은 지갑마다 달라 길이만 본다. */
export const ClaimRoleSchema = z.object({
  address: z.string().min(8).max(200),
  role: z.enum(['lender', 'supplier']),
});

export type ClaimRoleDto = z.infer<typeof ClaimRoleSchema>;

/** 상환. 금액은 원장에서 읽으므로 받지 않는다. */
export const RepayLoanSchema = z.object({ nullifier: hex32Schema });
export type RepayLoanDto = z.infer<typeof RepayLoanSchema>;

/** 채권 등록 요청. 발급 기관이 승인해야 리프가 들어간다. */
export const RequestInvoiceSchema = z.object({
  faceAmount: z.string().regex(/^\d+$/),
  counterparty: z.string().min(1).max(120),
  dueDate: z.string().min(1).max(40),
  approvalNumber: z.string().min(1).max(60),
  memo: z.string().max(200).default(''),
  creditGrade: z.string().min(1).max(8).default('BBB'),
  dueWindow: z.string().min(1).max(20).default('60~90일'),
  industry: z.string().min(1).max(40).default('기타'),
});
export type RequestInvoiceDto = z.infer<typeof RequestInvoiceSchema>;

export const ApproveInvoiceSchema = z.object({ requestId: z.string().min(8).max(64) });
export type ApproveInvoiceDto = z.infer<typeof ApproveInvoiceSchema>;

/**
 * 브라우저가 리프를 올렸다는 보고.
 *
 * 서버는 이 값을 그대로 믿지 않는다. 발급자 트리에 그 리프가 있는지
 * 원장에서 확인한 뒤에만 기록한다 (ConfirmIssuanceUseCase).
 */
export const ConfirmIssuanceSchema = z.object({
  issuanceId: z.string().min(8).max(64),
  txHash: hex32Schema.nullable().default(null),
  block: z.number().int().nonnegative().nullable().default(null),
});
export type ConfirmIssuanceDto = z.infer<typeof ConfirmIssuanceSchema>;
