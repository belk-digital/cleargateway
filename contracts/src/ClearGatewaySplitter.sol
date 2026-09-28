// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice USDC transfer authorization per EIP-3009, as implemented by Circle's FiatTokenV2_2.
/// @dev Signature shape verified against circlefin/stablecoin-evm (contracts/v2/FiatTokenV2_2.sol).
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
}

/// @title ClearGatewaySplitter
/// @notice Non-custodial payment splitter. A customer pays a backend-signed payment intent; in the SAME
///         transaction the platform fee goes to `platformWallet` and the remainder to the merchant.
///         The contract never holds a balance between transactions and has no withdraw function.
/// @dev Future versions may add multi-recipient splits (merchant + affiliate + platform) by introducing a new
///      typed-data struct (new typehash / EIP-712 version) rather than mutating `PaymentIntent`.
contract ClearGatewaySplitter is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Payment terms signed by the backend signer. Binds merchant, amount, fee and payer.
    struct PaymentIntent {
        bytes32 intentId;
        address merchant;
        address payer;
        uint256 amount;
        uint256 feeBps;
        uint256 expiry;
    }

    /// @dev `token` is included so a signature can never be reinterpreted for another asset;
    ///      chainId and this contract's address are bound by the EIP-712 domain.
    bytes32 public constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(bytes32 intentId,address merchant,address token,address payer,uint256 amount,uint256 feeBps,uint256 expiry)"
    );

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Settlement token (USDC). Immutable: cannot be swapped by an admin.
    IERC20 public immutable token;

    /// @notice Address whose signatures authorize payment intents (backend / KMS key).
    address public signer;
    /// @notice Recipient of the platform fee.
    address public platformWallet;
    /// @notice Upper bound on `feeBps` accepted in any intent (<= 10_000).
    uint256 public maxFeeBps;

    /// @notice intentId => already paid. A second payment for the same intent reverts.
    mapping(bytes32 => bool) public paid;

    event PaymentSettled(
        bytes32 indexed intentId, address indexed payer, address indexed merchant, uint256 amount, uint256 fee
    );
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event MaxFeeBpsUpdated(uint256 oldMax, uint256 newMax);

    error ZeroAddress();
    error ZeroAmount();
    error IntentExpired();
    error IntentAlreadyPaid();
    error FeeTooHigh();
    error InvalidSignature();
    error NotPayer();
    error InvalidMaxFeeBps();
    error RenounceDisabled();

    constructor(IERC20 token_, address signer_, address platformWallet_, uint256 maxFeeBps_, address owner_)
        EIP712("ClearGatewaySplitter", "1")
        Ownable(owner_)
    {
        if (address(token_) == address(0) || signer_ == address(0) || platformWallet_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxFeeBps_ > BPS_DENOMINATOR) revert InvalidMaxFeeBps();
        token = token_;
        signer = signer_;
        platformWallet = platformWallet_;
        maxFeeBps = maxFeeBps_;
    }

    // ------------------------------------------------------------------ payments

    /// @notice Path 1: standard `approve` + `transferFrom`. Caller must be the signed payer.
    /// @dev Funds move payer -> merchant and payer -> platform directly; the contract never touches them.
    function pay(PaymentIntent calldata intent, bytes calldata signature) external nonReentrant whenNotPaused {
        if (msg.sender != intent.payer) revert NotPayer();
        (uint256 fee, uint256 merchantAmount) = _validateAndMarkPaid(intent, signature);

        if (merchantAmount > 0) token.safeTransferFrom(intent.payer, intent.merchant, merchantAmount);
        if (fee > 0) token.safeTransferFrom(intent.payer, platformWallet, fee);

        emit PaymentSettled(intent.intentId, intent.payer, intent.merchant, intent.amount, fee);
    }

    /// @notice Path 2: EIP-3009. The payer signs a `ReceiveWithAuthorization` to THIS contract (nonce = intentId),
    ///         so no separate approval is needed. Anyone may submit (e.g. a relayer); only this contract can
    ///         consume the authorization because USDC requires `to == msg.sender`.
    /// @param validAfter / validBefore EIP-3009 validity window, as signed by the payer.
    /// @param authSignature The payer's EIP-3009 signature (bytes form, per FiatTokenV2_2).
    function payWithAuthorization(
        PaymentIntent calldata intent,
        bytes calldata intentSignature,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata authSignature
    ) external nonReentrant whenNotPaused {
        (uint256 fee, uint256 merchantAmount) = _validateAndMarkPaid(intent, intentSignature);

        // Pull into this contract (required by USDC's payee check), then forward everything in the same tx.
        IReceiveWithAuthorization(address(token)).receiveWithAuthorization(
            intent.payer, address(this), intent.amount, validAfter, validBefore, intent.intentId, authSignature
        );
        if (merchantAmount > 0) token.safeTransfer(intent.merchant, merchantAmount);
        if (fee > 0) token.safeTransfer(platformWallet, fee);

        emit PaymentSettled(intent.intentId, intent.payer, intent.merchant, intent.amount, fee);
    }

    /// @notice EIP-712 digest the backend signer must sign for `intent`.
    function hashIntent(PaymentIntent calldata intent) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_INTENT_TYPEHASH,
                    intent.intentId,
                    intent.merchant,
                    address(token),
                    intent.payer,
                    intent.amount,
                    intent.feeBps,
                    intent.expiry
                )
            )
        );
    }

    /// @notice Fee math. MUST match `splitAmount` in packages/shared/src/money.ts: fee rounds DOWN,
    ///         merchant receives the remainder, so fee + merchantAmount == amount.
    function computeSplit(uint256 amount, uint256 feeBps) public pure returns (uint256 fee, uint256 merchantAmount) {
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        merchantAmount = amount - fee;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -------------------------------------------------------------------- admin
    // No function here can move user funds: the contract holds none and exposes no withdraw.

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function setPlatformWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        emit PlatformWalletUpdated(platformWallet, newWallet);
        platformWallet = newWallet;
    }

    function setMaxFeeBps(uint256 newMax) external onlyOwner {
        if (newMax > BPS_DENOMINATOR) revert InvalidMaxFeeBps();
        emit MaxFeeBpsUpdated(maxFeeBps, newMax);
        maxFeeBps = newMax;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Disabled: renouncing would make the signer/pause controls permanently unreachable.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ----------------------------------------------------------------- internals

    function _validateAndMarkPaid(PaymentIntent calldata intent, bytes calldata signature)
        internal
        returns (uint256 fee, uint256 merchantAmount)
    {
        if (intent.merchant == address(0)) revert ZeroAddress();
        if (intent.amount == 0) revert ZeroAmount();
        if (block.timestamp > intent.expiry) revert IntentExpired();
        if (intent.feeBps > maxFeeBps) revert FeeTooHigh();
        if (paid[intent.intentId]) revert IntentAlreadyPaid();
        if (ECDSA.recover(hashIntent(intent), signature) != signer) revert InvalidSignature();

        // Effects before interactions.
        paid[intent.intentId] = true;
        (fee, merchantAmount) = computeSplit(intent.amount, intent.feeBps);
    }
}
