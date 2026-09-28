import { concat, getContractAddress, getCreate2Address, keccak256, type Address, type Hex } from "viem";

/**
 * EIP-1167 minimal proxy layout used by OpenZeppelin `Clones` (and therefore by DepositFactory):
 *   creation prefix (10 bytes) + runtime prefix (10 bytes) + implementation (20 bytes) + runtime suffix (15 bytes)
 * The Foundry test `test_predict_matchesManualCreate2OfEip1167Clone` pins the same layout on the Solidity side, and the
 * worker E2E test proves this file agrees with `DepositFactory.predict()` on a real chain.
 */
const EIP1167_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" as const;
const EIP1167_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3" as const;

/** Creation code of the clone deployed for a deposit address (55 bytes). */
export function cloneInitCode(implementation: Address): Hex {
  return concat([EIP1167_PREFIX, implementation, EIP1167_SUFFIX]);
}

/**
 * Deposit address for a payment: CREATE2 from the factory with `salt = intentId` (the bytes32 stored as
 * `payment_intents.intent_hash`). Computable before anything is deployed.
 */
export function predictDepositAddress(args: { factory: Address; implementation: Address; salt: Hex }): Address {
  return getCreate2Address({ from: args.factory, salt: args.salt, bytecodeHash: keccak256(cloneInitCode(args.implementation)) });
}

/**
 * The DepositForwarder implementation is created by the factory's constructor, so its address is the factory's first
 * contract creation (nonce 1, per EIP-161). Read `factory.implementation()` on-chain in production; this exists so
 * tests can prove the two agree.
 */
export function predictImplementationAddress(factory: Address): Address {
  return getContractAddress({ from: factory, nonce: 1n });
}
