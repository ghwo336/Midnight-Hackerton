/**
 * 배포에 쓰이는 데모 고정값.
 *
 * **API 의 apps/api/src/config/demo.config.ts 와 같은 값이어야 한다.**
 * 온체인 채권 리프는 (invoiceId, faceAmount, ownerPk) 로 계산된다. 두
 * 곳이 갈라지면 신청이 회로의 `assert(path.leaf == leaf)` 에서 거부되고,
 * 화면에는 "invoice leaf mismatch" 라는 회로 메시지만 남아 원인이
 * 값 불일치라는 걸 알기 어렵다. 테스트가 이 결합을 지킨다
 * (test/contract-tests/demo-fixtures.spec.ts).
 *
 * Midnight SDK 를 끌어오지 않는 자리에 둔다. 테스트가 이 값만 읽으려고
 * 브라우저 전용 모듈을 통째로 불러오지 않게 한다.
 *
 * **issuerSecret 은 여기 없다.** 저장소에 적힌 더미값을 테스트넷에 올리면
 * 누구나 registerInvoice·fundLender 를 부를 수 있다. 배포용 비밀키는
 * 첫 실행 때 기기에서 만들어 IndexedDB 에만 둔다 (`ensureIssuerSecret`).
 *
 * supplierSecret 은 다르다. 채권 리프를 계산하는 데 쓰이고 배포된
 * 컨트랙트가 이미 이 값의 소유자 공개키로 리프를 담고 있다. 데모 채권의
 * 소유자가 데모 인물이라는 뜻이고, 그건 의도한 바다.
 */
export const DEMO = {
  issuerId: `0x${'11'.repeat(32)}`,
  supplierSecret: `0x${'7c'.repeat(32)}`,
  ltvBps: 8000n,
  lenders: [
    { id: 'lender-a', key: `0x${'0a'.repeat(32)}`, label: '금융사 A' },
    { id: 'lender-b', key: `0x${'0b'.repeat(32)}`, label: '금융사 B' },
  ],
  funding: 1_000_000_000n,
  invoices: [
    { id: `0x${'a1'.repeat(32)}`, faceAmount: 100_000_000n },
    { id: `0x${'a2'.repeat(32)}`, faceAmount: 50_000_000n },
    { id: `0x${'a3'.repeat(32)}`, faceAmount: 250_000_000n },
  ],
} as const;
