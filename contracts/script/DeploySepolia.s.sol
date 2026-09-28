// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";

/// @notice Deploys ClearGatewaySplitter to Base Sepolia ONLY. There is deliberately no mainnet script.
/// Env: USDC_ADDRESS, SIGNER_ADDRESS, PLATFORM_WALLET_ADDRESS, OWNER_ADDRESS, MAX_FEE_BPS (optional, default 1000).
/// Provide the deployer key on the CLI (--private-key / --account / --ledger); never in a file.
contract DeploySepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    /// @dev Circle's published Base Sepolia USDC (developers.circle.com/stablecoins/usdc-contract-addresses).
    address internal constant CIRCLE_BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external returns (ClearGatewaySplitter splitter) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "DeploySepolia: only Base Sepolia (84532)");

        address usdc = vm.envAddress("USDC_ADDRESS");
        require(usdc == CIRCLE_BASE_SEPOLIA_USDC, "DeploySepolia: USDC_ADDRESS is not Circle's Base Sepolia USDC");
        address signer = vm.envAddress("SIGNER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 maxFeeBps = vm.envOr("MAX_FEE_BPS", uint256(1000));

        vm.startBroadcast();
        splitter = new ClearGatewaySplitter(IERC20(usdc), signer, platform, maxFeeBps, owner);
        vm.stopBroadcast();

        console2.log("ClearGatewaySplitter deployed:", address(splitter));
        console2.log("chainId:", block.chainid);
        console2.log("Set SPLITTER_ADDRESS to the address above.");
    }
}
