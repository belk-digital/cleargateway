// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ClearGatewaySplitter} from "./ClearGatewaySplitter.sol";
import {DepositForwarder} from "./DepositForwarder.sol";

/// @title DepositFactory
/// @notice Deterministic per-payment deposit addresses (CREATE2 minimal-proxy clones of `DepositForwarder`).
///         The address for an intent is known off-chain before any funds arrive (`predict`) and needs no deployment
///         until the deposit is swept, so an unused address costs nothing.
///
/// Trust model: there is NO owner, admin, pause or upgrade path in this contract. The implementation and splitter are
/// immutable. Authority comes solely from signatures by `splitter.signer()` (rotated with the splitter):
///  - `sweep`: an EIP-712 `PaymentIntent` (ClearGatewaySplitter's domain) whose `payer` is the deposit address; recipients
///    and amounts are fixed by the signature, so `sweep` itself is permissionless (anyone may relay it, e.g. a gas
///    relayer) and cannot redirect funds.
///  - `rescue`: a separate EIP-712 `Rescue` (this contract's domain) for funds outside a settled payment. It uses a
///    DIFFERENT typed-data domain and struct than intents, so a sweep signature sitting in a mempool can never be
///    replayed as a rescue to skip the platform fee (and vice versa).
/// A compromised signer can therefore redirect any funds currently sitting in deposit addresses; see SECURITY.md.
contract DepositFactory is EIP712, ReentrancyGuard {
    bytes32 public constant RESCUE_TYPEHASH =
        keccak256("Rescue(bytes32 intentId,address forwarder,address token,address to,uint256 amount,uint256 expiry)");

    ClearGatewaySplitter public immutable splitter;
    /// @notice The `DepositForwarder` implementation every deposit address clones. Deployed by this factory.
    address public immutable implementation;

    /// @notice Rescue digests already executed (a signature works once).
    mapping(bytes32 => bool) public rescueUsed;

    event Swept(bytes32 indexed intentId, address indexed forwarder);
    event Rescued(bytes32 indexed intentId, address indexed forwarder, address indexed token, address to, uint256 amount);

    error PayerNotForwarder();
    error InvalidSignature();
    error RescueExpired();
    error RescueAlreadyUsed();

    constructor(ClearGatewaySplitter splitter_) EIP712("ClearGatewayDepositFactory", "1") {
        splitter = splitter_;
        implementation = address(new DepositForwarder(splitter_));
    }

    /// @notice The deposit address for `intentId` (salt = intentId). Pure function of (factory, implementation, intentId).
    function predict(bytes32 intentId) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, intentId, address(this));
    }

    /// @notice Pays `intent` from its deposit address. `intent.payer` must be `predict(intent.intentId)`.
    ///         Deploys the clone first if needed. Atomic: any failure (invalid signature, deposit too small, paused
    ///         splitter, replay) reverts everything, including the deployment.
    function sweep(ClearGatewaySplitter.PaymentIntent calldata intent, bytes calldata signature)
        external
        nonReentrant
        returns (address forwarder)
    {
        forwarder = predict(intent.intentId);
        if (intent.payer != forwarder) revert PayerNotForwarder();
        _ensureDeployed(intent.intentId, forwarder);
        DepositForwarder(forwarder).forward(intent, signature);
        emit Swept(intent.intentId, forwarder);
    }

    /// @notice Moves `amount` of `token` out of `intentId`'s deposit address to `to`, authorized by a backend signature
    ///         over (intentId, forwarder, token, to, amount, expiry). For funds that are not part of a settled payment.
    function rescue(bytes32 intentId, IERC20 token, address to, uint256 amount, uint256 expiry, bytes calldata signature)
        external
        nonReentrant
    {
        if (block.timestamp > expiry) revert RescueExpired();
        bytes32 digest = hashRescue(intentId, token, to, amount, expiry);
        if (rescueUsed[digest]) revert RescueAlreadyUsed();
        if (ECDSA.recover(digest, signature) != splitter.signer()) revert InvalidSignature();
        rescueUsed[digest] = true;

        address forwarder = predict(intentId);
        _ensureDeployed(intentId, forwarder);
        DepositForwarder(forwarder).rescue(token, to, amount);
        emit Rescued(intentId, forwarder, address(token), to, amount);
    }

    /// @notice EIP-712 digest the backend signer must sign for a rescue.
    function hashRescue(bytes32 intentId, IERC20 token, address to, uint256 amount, uint256 expiry)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(RESCUE_TYPEHASH, intentId, predict(intentId), address(token), to, amount, expiry))
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _ensureDeployed(bytes32 intentId, address forwarder) internal {
        if (forwarder.code.length == 0) {
            address deployed = Clones.cloneDeterministic(implementation, intentId);
            assert(deployed == forwarder);
        }
    }
}
