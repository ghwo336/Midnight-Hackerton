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
