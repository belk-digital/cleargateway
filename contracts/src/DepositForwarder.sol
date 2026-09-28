// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ClearGatewaySplitter} from "./ClearGatewaySplitter.sol";

/// @title DepositForwarder
/// @notice Implementation contract for per-payment deposit addresses, used through EIP-1167 minimal-proxy clones
///         created by `DepositFactory`. A customer (typically an exchange withdrawal) sends plain USDC to the clone's
///         address; the factory later makes the clone pay `ClearGatewaySplitter` with a backend-signed intent whose `payer`
///         is the clone itself, so the merchant/platform split still happens on-chain in one transaction.
/// @dev Only the factory can call anything here. Immutables live in this implementation's bytecode and are read by
///      every clone through delegatecall. `address(this)` inside a clone is the clone's own (deposit) address.
///      No ETH handling: there is no `receive`/`fallback`, so plain ETH transfers revert.
contract DepositForwarder {
    using SafeERC20 for IERC20;

    /// @notice The factory that deploys clones and is the only caller allowed to use them.
    address public immutable factory;
    ClearGatewaySplitter public immutable splitter;
    IERC20 public immutable token;

    error OnlyFactory();
    error PayerNotForwarder();
    error InsufficientDeposit(uint256 balance, uint256 required);
    error ZeroAddress();

    constructor(ClearGatewaySplitter splitter_) {
        factory = msg.sender;
        splitter = splitter_;
        token = splitter_.token();
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    /// @notice Pays `intent` from this deposit address through the splitter. Reverts (undoing everything, including
    ///         the clone deployment) if the deposit does not cover `intent.amount` or the signature is invalid.
    function forward(ClearGatewaySplitter.PaymentIntent calldata intent, bytes calldata signature) external onlyFactory {
        if (intent.payer != address(this)) revert PayerNotForwarder();
        uint256 balance = token.balanceOf(address(this));
        if (balance < intent.amount) revert InsufficientDeposit(balance, intent.amount);

        token.forceApprove(address(splitter), intent.amount);
        splitter.pay(intent, signature); // the splitter validates signer, expiry, fee cap, one-payment-per-intent
        // The splitter pulls exactly `amount`, so the allowance is already 0; never leave a dangling approval.
        if (token.allowance(address(this), address(splitter)) != 0) token.forceApprove(address(splitter), 0);
    }

    /// @notice Moves funds that are NOT part of a settled payment (overpayment excess, underpaid/late deposits,
    ///         wrong tokens) to `to`. Authorization (a backend signature naming `to`) is verified by the factory.
    function rescue(IERC20 token_, address to, uint256 amount) external onlyFactory {
        if (to == address(0)) revert ZeroAddress();
        token_.safeTransfer(to, amount);
    }
}
