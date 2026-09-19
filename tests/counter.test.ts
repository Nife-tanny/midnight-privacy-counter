// Unit tests for contracts/counter.compact, run entirely against the local
// Compact simulator (@midnight-ntwrk/compact-runtime) — no network, wallet,
// or proof server required. This exercises the real compiled circuit logic
// (contracts/managed/counter/contract/index.js), not a re-implementation of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createConstructorContext,
  createCircuitContext,
  emptyZswapLocalState,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger,
  pureCircuits,
  type Witnesses,
} from '../managed/counter/contract/index.js';

type PrivateState = null;

const COIN_PUBLIC_KEY = { bytes: new Uint8Array(32).fill(1) };
const OWNER_SECRET = new Uint8Array(32).fill(7);
const OTHER_SECRET = new Uint8Array(32).fill(9);

// The witness is how a real caller's TypeScript runtime supplies the private
// secret at call time. It never touches the ledger — only its derived hash does.
function witnessesFor(secret: Uint8Array): Witnesses<PrivateState> {
  return {
    secretKey: () => [null, secret],
  };
}

function deploy(ownerSecret: Uint8Array) {
  const ownerKey = pureCircuits.deriveOwnerKey(ownerSecret);
  const contract = new Contract<PrivateState>(witnessesFor(ownerSecret));
  const ctorContext = createConstructorContext<PrivateState>(null, COIN_PUBLIC_KEY);
  const { currentContractState, currentPrivateState } = contract.initialState(ctorContext, ownerKey);
  return { contract, contractState: currentContractState, privateState: currentPrivateState, ownerKey };
}

function circuitContextFor(contractState: any, privateState: PrivateState) {
  return createCircuitContext<PrivateState>(
    sampleContractAddress(),
    emptyZswapLocalState(COIN_PUBLIC_KEY),
    contractState,
    privateState,
  );
}

test('circuit logic: getCount reads back the current public counter', () => {
  const { contract, contractState, privateState } = deploy(OWNER_SECRET);
  const { result } = contract.circuits.getCount(circuitContextFor(contractState, privateState));
  assert.equal(result, 0n);
});

test('state transitions: increment with the right secret bumps count by exactly 1', () => {
  const { contract, contractState, privateState } = deploy(OWNER_SECRET);

  const afterFirst = contract.circuits.increment(circuitContextFor(contractState, privateState));
  const firstCount = contract.circuits.getCount(afterFirst.context).result;
  assert.equal(firstCount, 1n);

  const afterSecond = contract.circuits.increment(afterFirst.context);
  const secondCount = contract.circuits.getCount(afterSecond.context).result;
  assert.equal(secondCount, 2n);
});

test('access control: increment with the wrong secret is rejected and count is unchanged', () => {
  const { contract: ownerContract, contractState, privateState, ownerKey } = deploy(OWNER_SECRET);
  const imposterContract = new Contract<PrivateState>(witnessesFor(OTHER_SECRET));

  assert.throws(() => imposterContract.circuits.increment(circuitContextFor(contractState, privateState)));

  const countAfterRejection = ownerContract.circuits.getCount(
    circuitContextFor(contractState, privateState),
  ).result;
  assert.equal(countAfterRejection, 0n);

  // Sanity check on the commitment itself: it's a hash, not the raw secret.
  assert.notEqual(Buffer.from(ownerKey).toString('hex'), Buffer.from(OWNER_SECRET).toString('hex'));
});

test('privacy: the raw secret never appears anywhere in the public ledger state', () => {
  const { contract, contractState, privateState } = deploy(OWNER_SECRET);
  const { context } = contract.circuits.increment(circuitContextFor(contractState, privateState));

  // The ledger only ever exposes `count` and `ownerKey` (a hash) — decode it
  // and confirm the raw secret bytes are nowhere in that public state.
  const publicLedger = ledger(context.currentQueryContext.state);
  const ownerKeyHex = Buffer.from(publicLedger.ownerKey).toString('hex');
  const secretHex = Buffer.from(OWNER_SECRET).toString('hex');
  assert.notEqual(ownerKeyHex, secretHex);
  assert.equal(publicLedger.count, 1n);
});
