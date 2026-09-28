// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {DepositFactory} from "../src/DepositFactory.sol";
import {DepositForwarder} from "../src/DepositForwarder.sol";
import {Fixtures} from "./Fixtures.sol";

/// @dev Splitter + USDC (from Fixtures) plus a DepositFactory, with helpers for deposit-address intents and rescues.
abstract contract DepositFixtures is Fixtures {
    DepositFactory internal factory;

    function _deployDeposit() internal {
        _deploy();
        factory = new DepositFactory(splitter);
    }

    /// @dev An intent paid FROM the deposit address (payer = predicted forwarder), as the backend signs it at sweep time.
    function _depositIntent(bytes32 id, uint256 amount, uint256 feeBps) internal view returns (ClearGatewaySplitter.PaymentIntent memory) {
        return ClearGatewaySplitter.PaymentIntent({
            intentId: id,
            merchant: merchant,
            payer: factory.predict(id),
            amount: amount,
            feeBps: feeBps,
            expiry: block.timestamp + 10 minutes
        });
    }

    function _signRescue(uint256 key, bytes32 id, IERC20 token_, address to, uint256 amount, uint256 expiry)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, factory.hashRescue(id, token_, to, amount, expiry));
        return abi.encodePacked(r, s, v);
    }

    /// @dev What an exchange does: a plain ERC-20 transfer to the (undeployed) deposit address.
    function _exchangeSends(bytes32 id, uint256 amount) internal {
        usdc.mint(factory.predict(id), amount);
    }
}

/// @dev Minimal ERC-20 used to check that non-USDC tokens sent to a deposit address are recoverable.
contract OtherToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
