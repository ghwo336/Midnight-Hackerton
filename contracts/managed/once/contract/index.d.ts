import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type LoanRecord = { lender: Uint8Array;
                           amount: bigint;
                           commitment: Uint8Array;
                           borrower: Uint8Array;
                           repaid: boolean
                         };

export type PrivateInvoice = { invoiceId: Uint8Array;
                               faceAmount: bigint;
                               salt: Uint8Array
                             };

export type Witnesses<PS> = {
  privateInvoice(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, PrivateInvoice];
  ownerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  invoicePath(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { leaf: Uint8Array,
                                                                            path: { sibling: { field: bigint
                                                                                             },
                                                                                    goes_left: boolean
                                                                                  }[]
                                                                          }];
  issuerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerInvoice(context: __compactRuntime.CircuitContext<PS>,
                  leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerLender(context: __compactRuntime.CircuitContext<PS>,
                 lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundLender(context: __compactRuntime.CircuitContext<PS>,
             lender_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  finance(context: __compactRuntime.CircuitContext<PS>,
          lender_0: Uint8Array,
          amount_0: bigint,
          recipient_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  repay(context: __compactRuntime.CircuitContext<PS>,
        nf_0: Uint8Array,
        amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerInvoice(context: __compactRuntime.CircuitContext<PS>,
                  leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerLender(context: __compactRuntime.CircuitContext<PS>,
                 lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundLender(context: __compactRuntime.CircuitContext<PS>,
             lender_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  finance(context: __compactRuntime.CircuitContext<PS>,
          lender_0: Uint8Array,
          amount_0: bigint,
          recipient_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  repay(context: __compactRuntime.CircuitContext<PS>,
        nf_0: Uint8Array,
        amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  ownerPublicKey(sk_0: Uint8Array): Uint8Array;
  issuerPublicKey(sk_0: Uint8Array): Uint8Array;
  invoiceLeaf(invoiceId_0: Uint8Array,
              faceAmount_0: bigint,
              ownerPk_0: Uint8Array): Uint8Array;
  nullifierOf(issuerId__0: Uint8Array, invoiceId_0: Uint8Array): Uint8Array;
  commitmentOf(invoiceId_0: Uint8Array,
               faceAmount_0: bigint,
               ownerPk_0: Uint8Array,
               salt_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  ownerPublicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  issuerPublicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  invoiceLeaf(context: __compactRuntime.CircuitContext<PS>,
              invoiceId_0: Uint8Array,
              faceAmount_0: bigint,
              ownerPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  nullifierOf(context: __compactRuntime.CircuitContext<PS>,
              issuerId__0: Uint8Array,
              invoiceId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  commitmentOf(context: __compactRuntime.CircuitContext<PS>,
               invoiceId_0: Uint8Array,
               faceAmount_0: bigint,
               ownerPk_0: Uint8Array,
               salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registerInvoice(context: __compactRuntime.CircuitContext<PS>,
                  leaf_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  registerLender(context: __compactRuntime.CircuitContext<PS>,
                 lender_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundLender(context: __compactRuntime.CircuitContext<PS>,
             lender_0: Uint8Array,
             amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  finance(context: __compactRuntime.CircuitContext<PS>,
          lender_0: Uint8Array,
          amount_0: bigint,
          recipient_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, []>;
  repay(context: __compactRuntime.CircuitContext<PS>,
        nf_0: Uint8Array,
        amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly issuerId: Uint8Array;
  readonly issuerPk: Uint8Array;
  readonly ltvBps: bigint;
  readonly fundingColor: Uint8Array;
  invoiceTree: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  usedNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  loans: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): LoanRecord;
    [Symbol.iterator](): Iterator<[Uint8Array, LoanRecord]>
  };
  registeredLenders: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  lenderVault: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  borrowerBalance: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               issuerId__0: Uint8Array,
               issuerPk__0: Uint8Array,
               ltvBps__0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
