import { webcrypto } from 'node:crypto';
import { useNetwork } from './config.js';
import { unshieldedAddress } from './wallet.js';

/**
 * 자금을 받을 주소를 출력한다.
 *
 * DEPLOY_WALLET_SEED가 없으면 새 시드를 만들어 보여준다. 시드는 비밀값이므로
 * 커밋하지 않고 .env에만 둔다 (SPEC §14).
 */
const config = useNetwork();

const existing = process.env['DEPLOY_WALLET_SEED'];
const seed =
  existing && /^[0-9a-f]{64}$/.test(existing)
    ? existing
    : Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('hex');

const address = unshieldedAddress(seed);

console.log('');
console.log(`network            ${config.name}`);
if (!existing) {
  console.log('');
  console.log('새 시드를 만들었다. .env에 넣고 커밋하지 말 것:');
  console.log(`DEPLOY_WALLET_SEED=${seed}`);
}
console.log('');
console.log('tNight를 받을 주소 (faucet에 넣는 값):');
console.log(`  ${address}`);
console.log('');
console.log('faucet: https://faucet.preprod.midnight.network/');
console.log('자금 반영까지 2~3분.');
/*
 * tNIGHT 을 들고 있으면 DUST 가 저절로 생긴다는 말이 오래 적혀 있었는데
 * 사실이 아니다. 원장은 night 키에 테이블 항목이 있을 때만 DUST UTXO 를
 * 만든다. 그 항목을 만드는 것이 DustRegistration 이고, 등록 없이는 잔액이
 * 5,000 tNIGHT 여도 cap 이 0 이라 트랜잭션을 한 건도 못 낸다 (SPIKE S6-f).
 */
console.log('tNIGHT 만으로는 트랜잭션을 못 낸다. 수수료용 DUST 를 따로 등록해야 한다:');
console.log('  /devtools → 지갑 연결 → [DUST 생성 등록]  (docs/DEPLOY.md)');
console.log('');
