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
