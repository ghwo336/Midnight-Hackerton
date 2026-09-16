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
console.log('자금 반영까지 2~3분. tNight를 위임하면 수수료용 DUST가 자동 생성된다.');
console.log('');
