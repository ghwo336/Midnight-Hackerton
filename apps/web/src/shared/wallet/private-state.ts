'use client';

import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

/**
 * 브라우저 IndexedDB에 두는 비공개 상태.
 *
 * **이 파일이 제품 주장의 핵심이다.** 채권 원문·salt·소유자 비밀키가
 * 여기 들어가고, 서버로 나가지 않는다. 지금까지는 데모 편의를 위해
 * NestJS가 들고 있었고 README에 그 한계를 명시해 두었다 (SPEC §3.1).
 * 납품업체 역할이 브라우저로 오면 그 한계가 사라진다.
 *
 * LevelDB(levelPrivateStateProvider)는 Node 전용이라 브라우저에서 못 쓴다.
 */
const DB_NAME = 'once-private-state';
const DB_VERSION = 1;
const STORE_STATE = 'state';
const STORE_KEYS = 'signing-keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE);
      if (!db.objectStoreNames.contains(STORE_KEYS)) db.createObjectStore(STORE_KEYS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/**
 * 배포 인스턴스의 발급 기관 비밀키.
 *
 * 로컬 데모는 저장소에 적힌 더미값(0x5e…)을 쓴다. 로컬 회로 실행에는
 * 실제 자산이 없으므로 무해하다. **그 값을 테스트넷에 올리면 안 된다.**
 * 공개된 발급자 키로 배포하면 누구나 registerInvoice·fundLender를 부를 수
 * 있고, A8(발급자 사칭 차단) 주장이 배포된 인스턴스에서 무너진다.
 * Node 경로는 `requireSecret()`으로 이걸 거부한다.
 *
 * 브라우저에는 env가 없으므로 첫 실행 때 만들어서 이 기기에만 둔다.
 * 기기를 옮기면 같은 컨트랙트의 발급 기관 권한을 쓸 수 없다. 그게 맞다.
 */
const ISSUER_SECRET_KEY = 'issuerSecret';
const ISSUER_PK_KEY = 'issuerPublicKey';

/**
 * 유도된 발급 기관 공개키를 같이 저장한다.
 *
 * 진입 화면이 "이 기기가 발급 권한을 쥐었는가"를 판단해야 하는데, 그걸
 * 위해 비밀키에서 공개키를 유도하려면 회로 런타임(WASM)을 끌어와야 한다.
 * 첫 화면에 10MB 를 로드할 이유가 없다. 만들 때 한 번 유도해 두고
 * 여기서는 문자열만 비교한다.
 */
export async function writeIssuerPublicKey(hex: string): Promise<void> {
  await withStore<IDBValidKey>(STORE_KEYS, 'readwrite', (s) => s.put(hex, ISSUER_PK_KEY));
}

export async function readIssuerPublicKey(): Promise<string | null> {
  const value = await withStore<string | undefined>(STORE_KEYS, 'readonly', (s) =>
    s.get(ISSUER_PK_KEY),
  );
  return value ?? null;
}

export async function ensureIssuerSecret(): Promise<Uint8Array> {
  const existing = await withStore<Uint8Array | undefined>(STORE_KEYS, 'readonly', (s) =>
    s.get(ISSUER_SECRET_KEY),
  );
  if (existing instanceof Uint8Array && existing.length === 32) return existing;

  const fresh = crypto.getRandomValues(new Uint8Array(32));
  await withStore<IDBValidKey>(STORE_KEYS, 'readwrite', (s) => s.put(fresh, ISSUER_SECRET_KEY));
  return fresh;
}

/**
 * 13개 메서드 전부를 구현한다.
 *
 * 내보내기/가져오기는 지원하지 않는다. 비공개 상태를 파일로 빼내는 경로를
 * 만들면 "원문이 기기를 떠나지 않는다"는 주장이 약해진다. 필요해지면
 * 그때 암호화와 함께 설계한다.
 */
export function indexedDbPrivateStateProvider<
  PSI extends string,
  PS,
>(recorder?: { privateStateReads: number }): PrivateStateProvider<PSI, PS> {
  const unsupported = (what: string) => async (): Promise<never> => {
    throw new Error(`${what}는 지원하지 않는다. 비공개 상태는 이 기기를 떠나지 않는다.`);
  };

  return {
    setContractAddress: () => undefined,

    set: (id, state) =>
      withStore<IDBValidKey>(STORE_STATE, 'readwrite', (s) => s.put(state, id)).then(() => undefined),
    /*
     * 읽힌 횟수를 센다. S6-c 의 증거 절반이다.
     * 나머지 절반은 회로가 issuerPublicKey(issuerSecret()) == issuerPk 를
     * 통과하는 것인데, 그게 되면 여기서 읽은 값이 올바른 비밀키였다는
     * 뜻이다. 로그가 아니라 회로가 증명한다.
     */
    get: (id) =>
      withStore<PS | undefined>(STORE_STATE, 'readonly', (s) => s.get(id)).then((v) => {
        if (recorder) recorder.privateStateReads += 1;
        return v ?? null;
      }),
    remove: (id) =>
      withStore<undefined>(STORE_STATE, 'readwrite', (s) => s.delete(id)).then(() => undefined),
    clear: () =>
      withStore<undefined>(STORE_STATE, 'readwrite', (s) => s.clear()).then(() => undefined),

    setSigningKey: (address, key) =>
      withStore<IDBValidKey>(STORE_KEYS, 'readwrite', (s) => s.put(key, address)).then(() => undefined),
    getSigningKey: (address) =>
      withStore<string | undefined>(STORE_KEYS, 'readonly', (s) => s.get(address)).then(
        (v) => (v ?? null) as never,
      ),
    removeSigningKey: (address) =>
      withStore<undefined>(STORE_KEYS, 'readwrite', (s) => s.delete(address)).then(() => undefined),
    clearSigningKeys: () =>
      withStore<undefined>(STORE_KEYS, 'readwrite', (s) => s.clear()).then(() => undefined),

    exportPrivateStates: unsupported('비공개 상태 내보내기'),
    importPrivateStates: unsupported('비공개 상태 가져오기'),
    exportSigningKeys: unsupported('서명키 내보내기'),
    importSigningKeys: unsupported('서명키 가져오기'),
  } as PrivateStateProvider<PSI, PS>;
}
