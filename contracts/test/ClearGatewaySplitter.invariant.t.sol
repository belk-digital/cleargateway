// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {Fixtures} from "./Fixtures.sol";

/// @dev Drives random valid and invalid payments; every call must leave the splitter with 0 USDC.
contract Handler is Fixtures {
    uint256 public nonce;
    uint256 public totalPaid;

    constructor(MockUSDC usdc_, ClearGatewaySplitter splitter_) {
        usdc = usdc_;
        splitter = splitter_;
    }

    function payAllowance(uint256 amount, uint256 feeBps) external {
        amount = bound(amount, 1, 1e15);
        feeBps = bound(feeBps, 0, MAX_FEE_BPS);
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(splitter), amount);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(keccak256(abi.encode(++nonce)), amount, feeBps);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        splitter.pay(i, sig);
        totalPaid += amount;
    }

    function payAuthorization(uint256 amount, uint256 feeBps) external {
        amount = bound(amount, 1, 1e15);
        feeBps = bound(feeBps, 0, MAX_FEE_BPS);
        usdc.mint(payer, amount);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(keccak256(abi.encode(++nonce)), amount, feeBps);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _authFor(i, block.timestamp + 1 hours);
        vm.prank(relayer);
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
        totalPaid += amount;
    }

    /// @dev Invalid attempts (tampered fee, replay) must revert without leaving funds behind.
    function payTampered(uint256 amount) external {
        amount = bound(amount, 1, 1e15);
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(splitter), amount);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(keccak256(abi.encode(++nonce)), amount, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.feeBps = 0;
        vm.prank(payer);
        try splitter.pay(i, sig) {
            revert("tampered payment succeeded");
        } catch {}
    }
}

contract ClearGatewaySplitterInvariantTest is Fixtures {
    Handler internal handler;

    function setUp() public {
        _deploy();
        handler = new Handler(usdc, splitter);
        targetContract(address(handler));
    }

    function invariant_splitterHoldsNoUsdc() public view {
        assertEq(usdc.balanceOf(address(splitter)), 0);
    }

    function invariant_everyPaidUsdcReachedMerchantOrPlatform() public view {
        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(platform), handler.totalPaid());
    }
}
