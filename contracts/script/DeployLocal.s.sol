// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Local Anvil only (chainId 31337): deploys MockUSDC + ClearGatewaySplitter for development and E2E tests.
/// Env: SIGNER_ADDRESS, PLATFORM_WALLET_ADDRESS, OWNER_ADDRESS.
contract DeployLocal is Script {
    function run() external returns (MockUSDC usdc, ClearGatewaySplitter splitter) {
        require(block.chainid == 31337, "DeployLocal: only local Anvil (31337)");

        address signer = vm.envAddress("SIGNER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");

        vm.startBroadcast();
        usdc = new MockUSDC();
        splitter = new ClearGatewaySplitter(usdc, signer, platform, 1000, owner);
        vm.stopBroadcast();

        console2.log("MockUSDC:", address(usdc));
        console2.log("ClearGatewaySplitter:", address(splitter));
    }
}
