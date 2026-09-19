/**
 * 발급 기관 키 파일.
 *
 * 발급 기관 비밀키는 배포한 브라우저의 IndexedDB 에만 있다. 브라우저
 * 데이터를 지우면 그 컨트랙트의 발급 권한이 **영구히 사라진다.** 인수인계도
 * 백업도 불가능하다. 그래서 내보내기·가져오기를 둔다.
 *
 * **이 파일에 채권 원문은 들어가지 않는다.** 나가는 것은 서명키 하나뿐이다.
 * 비공개 상태 저장소(채권 원문·salt·소유자 비밀키)는 여전히 내보낼 수 없고
 * 그 경로를 만들지 않는다.
 *
 * 순수 함수만 둔다. 회로 런타임(WASM)을 끌어오지 않으므로 테스트가 가볍다.
 */
export const ISSUER_KEY_FILE_KIND = 'once-issuer-key';
export const ISSUER_KEY_FILE_VERSION = 1;

export interface IssuerKeyFile {
  readonly kind: typeof ISSUER_KEY_FILE_KIND;
  readonly version: number;
  /** 어느 네트워크의 컨트랙트인가. 'local-circuit' 이면 실제 체인이 아니다. */
  readonly network: string;
  /** 어느 컨트랙트의 발급 권한인가. 0x 접두사 없이 적는다 (원장 표기와 같게). */
  readonly contractAddress: string;
  /** 비밀키에서 유도한 공개키. 가져올 때 이 값을 믿지 않고 다시 유도한다. */
  readonly issuerPublicKey: string;
  readonly issuerSecretKey: string;
  readonly exportedAt: string;
  readonly warning: string;
}

const HEX32 = /^0x[0-9a-f]{64}$/;

export const KEY_FILE_WARNING =
  '이 파일을 가진 사람은 해당 컨트랙트에 채권을 발급할 수 있다. ' +
  '공유하거나 저장소에 커밋하지 말 것.';

export function buildIssuerKeyFile(input: {
  readonly secretKey: string;
  readonly publicKey: string;
  readonly network: string;
  readonly contractAddress: string;
}): IssuerKeyFile {
  return {
    kind: ISSUER_KEY_FILE_KIND,
    version: ISSUER_KEY_FILE_VERSION,
    network: input.network,
    contractAddress: input.contractAddress.replace(/^0x/, ''),
    issuerPublicKey: input.publicKey,
    issuerSecretKey: input.secretKey,
    exportedAt: new Date().toISOString(),
    warning: KEY_FILE_WARNING,
  };
}

/** 파일 이름. 어느 컨트랙트 것인지 파일명만 봐도 알 수 있게 한다. */
export function issuerKeyFileName(contractAddress: string): string {
  const short = contractAddress.replace(/^0x/, '').slice(0, 8);
  return `once-issuer-key-${short}.json`;
}

/**
 * 파일을 읽는다. 형식이 아니면 **무엇이 잘못됐는지 말하고** 멈춘다.
 *
 * "잘못된 파일입니다" 한 줄로 뭉개면, 사용자는 받은 파일이 깨진 건지
 * 엉뚱한 파일을 고른 건지 알 수 없다.
 */
export function parseIssuerKeyFile(text: string): IssuerKeyFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON 으로 읽을 수 없다. 내보내기로 만든 파일인지 확인한다');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('JSON 최상위가 객체가 아니다');
  }

  const o = raw as Record<string, unknown>;
  if (o['kind'] !== ISSUER_KEY_FILE_KIND) {
    throw new Error(`발급 기관 키 파일이 아니다 (kind: ${String(o['kind'] ?? '없음')})`);
  }
  if (typeof o['issuerSecretKey'] !== 'string' || !HEX32.test(o['issuerSecretKey'])) {
    throw new Error('issuerSecretKey 가 32바이트 16진수가 아니다');
  }
  if (typeof o['contractAddress'] !== 'string' || o['contractAddress'] === '') {
    throw new Error('contractAddress 가 없다. 어느 컨트랙트의 키인지 알 수 없다');
  }

  return {
    kind: ISSUER_KEY_FILE_KIND,
    version: typeof o['version'] === 'number' ? o['version'] : 0,
    network: typeof o['network'] === 'string' ? o['network'] : '알 수 없음',
    contractAddress: o['contractAddress'].replace(/^0x/, ''),
    issuerPublicKey: typeof o['issuerPublicKey'] === 'string' ? o['issuerPublicKey'] : '',
    issuerSecretKey: o['issuerSecretKey'],
    exportedAt: typeof o['exportedAt'] === 'string' ? o['exportedAt'] : '',
    warning: typeof o['warning'] === 'string' ? o['warning'] : KEY_FILE_WARNING,
  };
}

/** 가져오기를 해도 되는가. */
export type ImportDecision =
  /** 원장의 발급 기관과 일치한다. 넣는다. */
  | { readonly kind: 'match'; readonly message: string }
  /**
   * 일치하지 않지만 넣어도 잃을 것이 없다. 경고와 함께 넣는다.
   * (다른 컨트랙트용 키를 미리 넣어 두는 경우가 있다.)
   */
  | { readonly kind: 'mismatch'; readonly message: string }
  /**
   * 넣으면 **지금 쓸 수 있는 키를 잃는다.** 막는다.
   *
   * 백업이 없어서 권한을 잃는 것을 막으려고 만든 기능인데, 그 기능으로
   * 바로 그 사고를 내면 안 된다.
   */
  | { readonly kind: 'refuse'; readonly message: string };

export function judgeImport(input: {
  /** 파일의 비밀키에서 **다시 유도한** 공개키. 파일에 적힌 값을 믿지 않는다. */
  readonly derivedPk: string;
  /** 원장이 말하는 발급 기관 공개키. 모르면 null. */
  readonly onChainPk: string | null;
  /** 지금 이 기기에 있는 키의 공개키. 없으면 null. */
  readonly currentPk: string | null;
  readonly contractAddress: string;
}): ImportDecision {
  const same = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

  if (input.onChainPk === null) {
    return {
      kind: 'mismatch',
      message: '원장의 발급 기관 공개키를 읽지 못해 대조하지 못했다. 넣기는 했다',
    };
  }
  if (same(input.derivedPk, input.onChainPk)) {
    return { kind: 'match', message: '원장의 발급 기관과 일치한다. 이 기기가 발급 권한을 갖는다' };
  }

  const short = `0x${input.contractAddress.replace(/^0x/, '').slice(0, 4)}…`;
  if (same(input.currentPk, input.onChainPk)) {
    return {
      kind: 'refuse',
      message:
        `이 키는 컨트랙트 ${short} 의 발급 기관이 아니다. ` +
        '그런데 지금 이 기기의 키는 맞다. 덮어쓰면 그 키를 잃으므로 넣지 않았다. ' +
        '먼저 내보내기로 백업할 것',
    };
  }
  return {
    kind: 'mismatch',
    message: `이 키는 컨트랙트 ${short} 의 발급 기관이 아니다`,
  };
}
