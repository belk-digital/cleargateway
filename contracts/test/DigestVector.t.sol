// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";

/// @dev Pins the EIP-712 digest for fixed inputs. packages/chain/src/eip712.test.ts asserts viem
///      produces the same digest, so the backend signer and the contract can never silently diverge.
contract DigestVectorTest is Test {
    address internal constant SPLITTER = 0x1111111111111111111111111111111111111111;
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function test_digestVector() public {
        vm.chainId(84532);
        deployCodeTo(
            "ClearGatewaySplitter.sol:ClearGatewaySplitter",
            abi.encode(IERC20(USDC), address(0xA1), address(0xA2), uint256(1000), address(0xA3)),
            SPLITTER
        );
        ClearGatewaySplitter s = ClearGatewaySplitter(SPLITTER);
        ClearGatewaySplitter.PaymentIntent memory i = ClearGatewaySplitter.PaymentIntent({
            intentId: keccak256("pi_vector"),
            merchant: 0x2222222222222222222222222222222222222222,
            payer: 0x3333333333333333333333333333333333333333,
            amount: 100_000_000,
            feeBps: 200,
            expiry: 1_800_000_000
        });
        console2.logBytes32(s.DOMAIN_SEPARATOR());
        console2.logBytes32(s.hashIntent(i));
        assertEq(s.DOMAIN_SEPARATOR(), EXPECTED_DOMAIN_SEPARATOR);
        assertEq(s.hashIntent(i), EXPECTED_DIGEST);
    }

    bytes32 internal constant EXPECTED_DOMAIN_SEPARATOR =
        0x2298290c89de0096cccec4a5679e3f7a6d4bd9acebac1856fcba291f81a9c8a1;
    bytes32 internal constant EXPECTED_DIGEST =
        0x674e5df85b0bb2ae873e90a4535582598bef6c7e7ae779a23c3ed5c590763e81;
}
