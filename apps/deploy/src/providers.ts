import { Buffer } from 'node:buffer';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import * as Rx from 'rxjs';
import {
  ONCE_PRIVATE_STATE_ID, PRIVATE_STATE_STORE, zkConfigPath, type NetworkConfig,
} from './config.js';
import type { WalletContext } from './wallet.js';

/**
 * 트랜잭션 intent에 서명한다.
 *
 * 지갑 SDK의 signRecipe가 proof 마커를 'pre-proof'로 하드코딩하는 버그가 있어,
 * 증명이 붙은(UnboundTransaction) intent에서 "Failed to clone intent"로 실패한다.
 * 공식 counter 예제와 같은 우회를 쓴다.
 */
function signTransactionIntents(
  tx: { intents?: Map<number, unknown> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment) as
      | { serialize(): Uint8Array }
      | undefined;
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<
      ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding
    >('signature', proofMarker, 'pre-binding', intent.serialize());

    const signature = signFn(cloned.signatureData(segment));

    if (cloned.fallibleUnshieldedOffer) {
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(
        cloned.fallibleUnshieldedOffer.inputs.map(
          (_: ledger.UtxoSpend, i: number) =>
            cloned.fallibleUnshieldedOffer?.signatures.at(i) ?? signature,
        ),
      );
    }
    if (cloned.guaranteedUnshieldedOffer) {
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(
        cloned.guaranteedUnshieldedOffer.inputs.map(
          (_: ledger.UtxoSpend, i: number) =>
            cloned.guaranteedUnshieldedOffer?.signatures.at(i) ?? signature,
        ),
      );
    }
    tx.intents.set(segment, cloned);
  }
}

export async function createWalletProvider(
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),

    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction as never, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction as never, signFn, 'pre-proof');
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },

    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as never;
    },
  };
}

export async function configureProviders(ctx: WalletContext, config: NetworkConfig) {
  const walletProvider = await createWalletProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  const accountId = walletProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

export { ONCE_PRIVATE_STATE_ID };
