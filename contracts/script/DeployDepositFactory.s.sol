// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {DepositFactory} from "../src/DepositFactory.sol";

/// @notice Deploys DepositFactory (and, through its constructor, the DepositForwarder implementation) for an existing
///         ClearGatewaySplitter. Base Sepolia ONLY. There is deliberately no mainnet script.
/// Env: SPLITTER_ADDRESS. Provide the deployer key on the CLI (--private-key / --account / --ledger), never in a file.
contract DeployDepositFactory is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (DepositFactory factory) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "DeployDepositFactory: only Base Sepolia (84532)");
        ClearGatewaySplitter splitter = ClearGatewaySplitter(vm.envAddress("SPLITTER_ADDRESS"));
        require(address(splitter).code.length > 0, "DeployDepositFactory: no contract at SPLITTER_ADDRESS");

        vm.startBroadcast();
        factory = new DepositFactory(splitter);
        vm.stopBroadcast();

        console2.log("DepositFactory:", address(factory));
        console2.log("DepositForwarder implementation:", factory.implementation());
        console2.log("Set DEPOSIT_FACTORY_ADDRESS to the factory address above.");
    }
}
