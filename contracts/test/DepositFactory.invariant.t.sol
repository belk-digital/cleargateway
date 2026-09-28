// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {DepositFactory} from "../src/DepositFactory.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DepositFixtures} from "./DepositFixtures.sol";

/// @dev Random deposits, exact sweeps, over/underpayments and rescues. Money is only ever in a deposit address,
///      the merchant or the platform: never in the factory or splitter.
contract DepositHandler is DepositFixtures {
    uint256 public nonce;
    uint256 public totalMinted;
    bytes32[] public ids;

    constructor(MockUSDC usdc_, ClearGatewaySplitter splitter_, DepositFactory factory_) {
        usdc = usdc_;
        splitter = splitter_;
        factory = factory_;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function depositAndSweep(uint256 amount, uint256 extra, uint256 feeBps) external {
        amount = bound(amount, 1, 1e12);
        extra = bound(extra, 0, 1e12);
        feeBps = bound(feeBps, 0, MAX_FEE_BPS);
        bytes32 id = keccak256(abi.encode(++nonce));
        ids.push(id);
        _exchangeSends(id, amount + extra);
        totalMinted += amount + extra;
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(id, amount, feeBps);
        vm.prank(relayer);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));
    }

    /// @dev Underpaid deposit that never completes: recovered to the merchant.
    function depositAndRescue(uint256 amount) external {
        amount = bound(amount, 1, 1e12);
        bytes32 id = keccak256(abi.encode(++nonce));
        ids.push(id);
        _exchangeSends(id, amount);
        totalMinted += amount;
        uint256 exp = block.timestamp + 1 hours;
        factory.rescue(id, usdc, merchant, amount, exp, _signRescue(SIGNER_KEY, id, usdc, merchant, amount, exp));
    }

    /// @dev Attacker attempts (must always revert without moving funds).
    function attackerTriesTampering(uint256 amount) external {
        amount = bound(amount, 1, 1e12);
        bytes32 id = keccak256(abi.encode(++nonce));
        ids.push(id);
        _exchangeSends(id, amount);
        totalMinted += amount;
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(id, amount, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.merchant = attacker;
        vm.prank(attacker);
        try factory.sweep(i, sig) {
            revert("tampered sweep succeeded");
        } catch {}
    }
}

contract DepositFactoryInvariantTest is DepositFixtures {
    DepositHandler internal handler;

    function setUp() public {
        _deployDeposit();
        handler = new DepositHandler(usdc, splitter, factory);
        targetContract(address(handler));
    }

    function invariant_factoryAndSplitterHoldNothing() public view {
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(usdc.balanceOf(address(splitter)), 0);
    }

    function invariant_conservation() public view {
        uint256 inForwarders;
        uint256 n = handler.idsLength();
        for (uint256 k = 0; k < n; k++) {
            inForwarders += usdc.balanceOf(factory.predict(handler.ids(k)));
        }
        assertEq(inForwarders + usdc.balanceOf(merchant) + usdc.balanceOf(platform), handler.totalMinted());
        assertEq(usdc.balanceOf(attacker), 0);
    }
}
