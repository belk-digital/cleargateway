// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @dev Shared deployment + signing helpers for the test suites.
abstract contract Fixtures is Test {
    MockUSDC internal usdc;
    ClearGatewaySplitter internal splitter;

    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant PAYER_KEY = 0xB0B;
    uint256 internal constant MAX_FEE_BPS = 1000;

    address internal signer = vm.addr(SIGNER_KEY);
    address internal payer = vm.addr(PAYER_KEY);
    address internal merchant = makeAddr("merchant");
    address internal platform = makeAddr("platform");
    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal attacker = makeAddr("attacker");

    function _deploy() internal {
        usdc = new MockUSDC();
        splitter = new ClearGatewaySplitter(usdc, signer, platform, MAX_FEE_BPS, owner);
    }

    function _intent(bytes32 id, uint256 amount, uint256 feeBps) internal view returns (ClearGatewaySplitter.PaymentIntent memory) {
        return ClearGatewaySplitter.PaymentIntent({
            intentId: id,
            merchant: merchant,
            payer: payer,
            amount: amount,
            feeBps: feeBps,
            expiry: block.timestamp + 1 hours
        });
    }

    function _signIntent(uint256 key, ClearGatewaySplitter.PaymentIntent memory i) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, splitter.hashIntent(i));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Payer's EIP-3009 ReceiveWithAuthorization to the splitter, nonce = intentId.
    function _signAuth(uint256 key, address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _authFor(ClearGatewaySplitter.PaymentIntent memory i, uint256 validBefore) internal view returns (bytes memory) {
        return _signAuth(PAYER_KEY, i.payer, address(splitter), i.amount, 0, validBefore, i.intentId);
    }
}
