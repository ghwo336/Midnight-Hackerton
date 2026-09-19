import { describe, expect, it } from 'vitest';
import {
  ISSUER_KEY_FILE_KIND, buildIssuerKeyFile, issuerKeyFileName,
  judgeImport, parseIssuerKeyFile,
} from '../../apps/web/src/shared/runtime/issuer-key-file.js';

/**
 * 발급 기관 키 파일.
 *
 * 이 키를 잃으면 배포된 컨트랙트의 발급 권한이 영구히 사라진다. 원장의
 * `issuerPk` 는 배포 때 고정돼 있고 회로가 그걸 assert 하므로, 새 키를
 * 만들어도 채권을 넣을 수 없다. 그래서 내보내기·가져오기가 있다.
 *
 * **가져오기가 그 사고를 내지 않아야 한다.** 지금 맞는 키가 있는데
 * 틀린 키로 덮으면, 막으려던 바로 그 일이 일어난다.
 */
const SECRET = `0x${'7c'.repeat(32)}`;
const PK_A = `0x${'aa'.repeat(32)}`;
const PK_B = `0x${'bb'.repeat(32)}`;
const CONTRACT = '52a72d93142c78a68871b4978d5258eb4be18d15fef44e20b4fc98dbb9ce5596';

const FILE = buildIssuerKeyFile({
  secretKey: SECRET, publicKey: PK_A, network: 'preprod', contractAddress: CONTRACT,
});

describe('키 파일 만들기', () => {
  it('어느 컨트랙트 것인지 담는다', () => {
    expect(FILE.contractAddress).toBe(CONTRACT);
    expect(FILE.kind).toBe(ISSUER_KEY_FILE_KIND);
  });

  it('0x 접두사를 붙이든 안 붙이든 같은 주소로 적는다', () => {
    const withPrefix = buildIssuerKeyFile({
      secretKey: SECRET, publicKey: PK_A, network: 'preprod', contractAddress: `0x${CONTRACT}`,
    });
    expect(withPrefix.contractAddress).toBe(CONTRACT);
  });

  it('파일명만 봐도 어느 컨트랙트 것인지 알 수 있다', () => {
    expect(issuerKeyFileName(CONTRACT)).toBe('once-issuer-key-52a72d93.json');
  });

  it('무엇을 조심해야 하는지 파일 안에 적는다', () => {
    expect(FILE.warning).toContain('발급할 수 있다');
  });
});

describe('키 파일 읽기', () => {
  it('내보낸 것을 그대로 읽는다', () => {
    const back = parseIssuerKeyFile(JSON.stringify(FILE));
    expect(back.issuerSecretKey).toBe(SECRET);
    expect(back.contractAddress).toBe(CONTRACT);
  });

  /*
   * "잘못된 파일입니다" 한 줄로 뭉개지 않는다. 받은 파일이 깨진 건지
   * 엉뚱한 파일을 고른 건지 구분할 수 있어야 한다.
   */
  it('JSON 이 아니면 그렇게 말한다', () => {
    expect(() => parseIssuerKeyFile('not json')).toThrow(/JSON/);
  });

  it('다른 종류의 JSON 이면 kind 를 짚어준다', () => {
    expect(() => parseIssuerKeyFile('{"kind":"something-else"}')).toThrow(/something-else/);
  });

  it('비밀키 형식이 아니면 거부한다', () => {
    const broken = { ...FILE, issuerSecretKey: '0xdeadbeef' };
    expect(() => parseIssuerKeyFile(JSON.stringify(broken))).toThrow(/32바이트/);
  });

  it('컨트랙트 주소가 없으면 거부한다', () => {
    const { contractAddress: _drop, ...rest } = FILE;
    expect(() => parseIssuerKeyFile(JSON.stringify(rest))).toThrow(/컨트랙트/);
  });
});

describe('가져오기 판정', () => {
  it('원장과 일치하면 넣는다', () => {
    const d = judgeImport({
      derivedPk: PK_A, onChainPk: PK_A, currentPk: null, contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('match');
  });

  it('안 맞고 이 기기에 키도 없으면 경고와 함께 넣는다', () => {
    const d = judgeImport({
      derivedPk: PK_B, onChainPk: PK_A, currentPk: null, contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('mismatch');
    expect(d.message).toContain('0x52a7…');
    expect(d.message).toContain('발급 기관이 아니다');
  });

  /*
   * 여기가 핵심이다. 백업이 없어 권한을 잃는 것을 막으려고 만든 기능이
   * 바로 그 사고를 내면 안 된다.
   */
  it('지금 맞는 키가 있는데 틀린 키가 들어오면 넣지 않는다', () => {
    const d = judgeImport({
      derivedPk: PK_B, onChainPk: PK_A, currentPk: PK_A, contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('refuse');
    expect(d.message).toContain('먼저 내보내기');
  });

  it('지금 키도 틀렸으면 덮어써도 잃을 것이 없다', () => {
    const d = judgeImport({
      derivedPk: PK_B, onChainPk: PK_A, currentPk: `0x${'cc'.repeat(32)}`,
      contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('mismatch');
  });

  it('대문자로 적힌 공개키도 같은 값으로 본다', () => {
    const d = judgeImport({
      derivedPk: PK_A.toUpperCase(), onChainPk: PK_A, currentPk: null,
      contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('match');
  });

  it('원장을 못 읽었으면 일치한다고 말하지 않는다', () => {
    const d = judgeImport({
      derivedPk: PK_A, onChainPk: null, currentPk: null, contractAddress: CONTRACT,
    });
    expect(d.kind).toBe('mismatch');
    expect(d.message).toContain('대조하지 못했다');
  });
});
