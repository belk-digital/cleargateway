// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {DepositFactory} from "../src/DepositFactory.sol";
import {DepositForwarder} from "../src/DepositForwarder.sol";
import {DepositFixtures, OtherToken} from "./DepositFixtures.sol";

/// @dev Token that re-enters the factory while the splitter pulls funds from the forwarder.
contract ReentrantDepositToken is ERC20 {
    DepositFactory public factory;
    ClearGatewaySplitter.PaymentIntent internal intent;
    bytes internal sig;

    constructor() ERC20("Evil", "EVIL") {}

    function arm(DepositFactory f, ClearGatewaySplitter.PaymentIntent memory i, bytes memory s) external {
        factory = f;
        intent = i;
        sig = s;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public override returns (bool) {
        factory.sweep(intent, sig); // must be blocked by the reentrancy guard
        return true;
    }
}

contract DepositFactoryTest is DepositFixtures {
    bytes32 internal constant ID = keccak256("pi_deposit_1");

    function setUp() public {
        _deployDeposit();
    }

    // ------------------------------------------------------------- address derivation

    function test_predict_isDeterministicPerIntentAndCallerIndependent() public {
        address a = factory.predict(ID);
        vm.prank(attacker);
        assertEq(factory.predict(ID), a);
        assertTrue(factory.predict(keccak256("other")) != a);
        assertEq(a.code.length, 0); // counterfactual: nothing deployed yet
    }

    /// @dev Independent check of the CREATE2 + EIP-1167 layout that the TypeScript side re-implements.
    function test_predict_matchesManualCreate2OfEip1167Clone() public view {
        bytes memory initCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", factory.implementation(), hex"5af43d82803e903d91602b57fd5bf3"
        );
        address manual =
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), ID, keccak256(initCode))))));
        assertEq(factory.predict(ID), manual);
    }

    function test_implementation_isDeployedByFactoryAndLocked() public {
        DepositForwarder impl = DepositForwarder(factory.implementation());
        assertEq(impl.factory(), address(factory));
        assertEq(address(impl.splitter()), address(splitter));
        assertEq(address(impl.token()), address(usdc));
        // Direct use of the implementation (or any clone) by anyone but the factory is impossible.
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        vm.prank(attacker);
        vm.expectRevert(DepositForwarder.OnlyFactory.selector);
        impl.forward(i, hex"");
        vm.prank(attacker);
        vm.expectRevert(DepositForwarder.OnlyFactory.selector);
        impl.rescue(usdc, attacker, 1);
    }

    // ------------------------------------------------------------------------- sweep

    function test_sweep_deploysCloneAndSplitsInOneTx() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        address fwd = factory.predict(ID);
        assertEq(fwd.code.length, 0);

        vm.expectEmit(true, true, true, true, address(splitter));
        emit ClearGatewaySplitter.PaymentSettled(ID, fwd, merchant, 100e6, 2e6);
        vm.expectEmit(true, true, false, true, address(factory));
        emit DepositFactory.Swept(ID, fwd);
        vm.prank(relayer);
        address returned = factory.sweep(i, sig);

        assertEq(returned, fwd);
        assertGt(fwd.code.length, 0);
        assertEq(usdc.balanceOf(merchant), 98e6);
        assertEq(usdc.balanceOf(platform), 2e6);
        assertEq(usdc.balanceOf(fwd), 0);
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(usdc.balanceOf(address(splitter)), 0);
        assertEq(usdc.allowance(fwd, address(splitter)), 0);
        assertTrue(splitter.paid(ID));
    }

    function test_sweep_whenAlreadyDeployed() public {
        // Deploy the clone first via a rescue of an unrelated token, then fund and sweep.
        OtherToken other = new OtherToken();
        address fwd = factory.predict(ID);
        other.mint(fwd, 5);
        uint256 exp = block.timestamp + 1 hours;
        bytes memory rsig = _signRescue(SIGNER_KEY, ID, IERC20(address(other)), merchant, 5, exp);
        factory.rescue(ID, IERC20(address(other)), merchant, 5, exp, rsig);
        assertGt(fwd.code.length, 0);

        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));
        assertEq(usdc.balanceOf(merchant), 98e6);
    }

    function test_sweep_anyoneMayRelay_recipientsStillFixed() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(attacker);
        factory.sweep(i, sig);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(merchant), 98e6);
        assertEq(usdc.balanceOf(platform), 2e6);
    }

    function test_sweep_overpaymentLeavesExcessAtTheAddress() public {
        _exchangeSends(ID, 150e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));
        address fwd = factory.predict(ID);
        assertEq(usdc.balanceOf(merchant), 98e6);
        assertEq(usdc.balanceOf(platform), 2e6);
        assertEq(usdc.balanceOf(fwd), 50e6); // exactly the intent amount was swept
    }

    function test_revert_sweep_underpaid_andLeavesNothingBehind() public {
        _exchangeSends(ID, 99e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        address fwd = factory.predict(ID);
        vm.expectRevert(abi.encodeWithSelector(DepositForwarder.InsufficientDeposit.selector, 99e6, 100e6));
        factory.sweep(i, sig);
        assertEq(fwd.code.length, 0); // deployment rolled back too
        assertEq(usdc.balanceOf(fwd), 99e6); // deposit untouched
        assertFalse(splitter.paid(ID));

        // Top-up, then the same signed intent works.
        usdc.mint(fwd, 1e6);
        factory.sweep(i, sig);
        assertTrue(splitter.paid(ID));
    }

    function test_revert_sweep_payerIsNotTheDepositAddress() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        i.payer = attacker;
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.expectRevert(DepositFactory.PayerNotForwarder.selector);
        factory.sweep(i, sig);
    }

    function test_revert_sweep_depositAddressOfAnotherIntent() public {
        // Funds for intent A cannot be used to pay intent B.
        bytes32 idB = keccak256("pi_deposit_2");
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(idB, 100e6, 200);
        i.payer = factory.predict(ID);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.expectRevert(DepositFactory.PayerNotForwarder.selector);
        factory.sweep(i, sig);
    }

    function test_revert_sweep_wrongSignerOrTampered() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory bad = _signIntent(0xBAD, i);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(i, bad);

        bytes memory good = _signIntent(SIGNER_KEY, i);
        ClearGatewaySplitter.PaymentIntent memory t = i;
        t.merchant = attacker;
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(t, good);
        t = i;
        t.feeBps = 0;
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(t, good);
        t = i;
        t.amount = 1e6;
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(t, good);
    }

    function test_revert_sweep_expired() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.warp(i.expiry + 1);
        vm.expectRevert(ClearGatewaySplitter.IntentExpired.selector);
        factory.sweep(i, sig);
    }

    function test_revert_sweep_twice() public {
        _exchangeSends(ID, 200e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        factory.sweep(i, sig);
        vm.expectRevert(ClearGatewaySplitter.IntentAlreadyPaid.selector);
        factory.sweep(i, sig);
        assertEq(usdc.balanceOf(factory.predict(ID)), 100e6); // second 100 untouched
    }

    function test_revert_sweep_whenSplitterPaused() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(owner);
        splitter.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        factory.sweep(i, sig);
        vm.prank(owner);
        splitter.unpause();
        factory.sweep(i, sig);
        assertTrue(splitter.paid(ID));
    }

    function test_sweep_followsSignerRotation() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory oldSig = _signIntent(SIGNER_KEY, i);
        vm.prank(owner);
        splitter.setSigner(vm.addr(0xC0FFEE));
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(i, oldSig);
        factory.sweep(i, _signIntent(0xC0FFEE, i));
    }

    function test_revert_sweep_feeAboveCap() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, MAX_FEE_BPS + 1);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.expectRevert(ClearGatewaySplitter.FeeTooHigh.selector);
        factory.sweep(i, sig);
    }

    // ------------------------------------------------------------------------ rescue

    function test_rescue_excessAfterOverpayment_toSignedRecipient() public {
        _exchangeSends(ID, 150e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));

        uint256 exp = block.timestamp + 1 hours;
        bytes memory sig = _signRescue(SIGNER_KEY, ID, usdc, merchant, 50e6, exp);
        vm.expectEmit(true, true, true, true, address(factory));
        emit DepositFactory.Rescued(ID, factory.predict(ID), address(usdc), merchant, 50e6);
        vm.prank(relayer);
        factory.rescue(ID, usdc, merchant, 50e6, exp, sig);
        assertEq(usdc.balanceOf(factory.predict(ID)), 0);
        assertEq(usdc.balanceOf(merchant), 98e6 + 50e6);
    }

    function test_rescue_underpaidDeposit_beforeAnyDeployment() public {
        _exchangeSends(ID, 40e6);
        uint256 exp = block.timestamp + 1 hours;
        address fwd = factory.predict(ID);
        assertEq(fwd.code.length, 0);
        factory.rescue(ID, usdc, merchant, 40e6, exp, _signRescue(SIGNER_KEY, ID, usdc, merchant, 40e6, exp));
        assertEq(usdc.balanceOf(merchant), 40e6);
        assertGt(fwd.code.length, 0);
    }

    function test_rescue_wrongTokenSentToTheAddress() public {
        OtherToken other = new OtherToken();
        other.mint(factory.predict(ID), 7e6);
        uint256 exp = block.timestamp + 1 hours;
        factory.rescue(ID, IERC20(address(other)), merchant, 7e6, exp, _signRescue(SIGNER_KEY, ID, IERC20(address(other)), merchant, 7e6, exp));
        assertEq(other.balanceOf(merchant), 7e6);
    }

    function test_revert_rescue_wrongSigner_tamperedFields_expired_replay() public {
        _exchangeSends(ID, 40e6);
        uint256 exp = block.timestamp + 1 hours;
        bytes memory good = _signRescue(SIGNER_KEY, ID, usdc, merchant, 40e6, exp);
        bytes memory badSigner = _signRescue(0xBAD, ID, usdc, merchant, 40e6, exp);

        vm.expectRevert(DepositFactory.InvalidSignature.selector);
        factory.rescue(ID, usdc, merchant, 40e6, exp, badSigner);
        vm.expectRevert(DepositFactory.InvalidSignature.selector);
        factory.rescue(ID, usdc, attacker, 40e6, exp, good); // redirected recipient
        vm.expectRevert(DepositFactory.InvalidSignature.selector);
        factory.rescue(ID, usdc, merchant, 39e6, exp, good); // different amount
        vm.expectRevert(DepositFactory.InvalidSignature.selector);
        factory.rescue(keccak256("other"), usdc, merchant, 40e6, exp, good); // different deposit address

        factory.rescue(ID, usdc, merchant, 40e6, exp, good);
        vm.expectRevert(DepositFactory.RescueAlreadyUsed.selector);
        factory.rescue(ID, usdc, merchant, 40e6, exp, good);

        _exchangeSends(ID, 10e6);
        uint256 exp2 = block.timestamp + 10;
        bytes memory late = _signRescue(SIGNER_KEY, ID, usdc, merchant, 10e6, exp2);
        vm.warp(exp2 + 1);
        vm.expectRevert(DepositFactory.RescueExpired.selector);
        factory.rescue(ID, usdc, merchant, 10e6, exp2, late);
    }

    /// @dev A sweep signature visible in a mempool must not be usable to rescue (which would skip the platform fee).
    function test_domainSeparation_intentSignatureCannotAuthorizeRescue() public {
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        bytes memory intentSig = _signIntent(SIGNER_KEY, i);
        vm.prank(attacker);
        vm.expectRevert(DepositFactory.InvalidSignature.selector);
        factory.rescue(ID, usdc, merchant, 100e6, i.expiry, intentSig);
        assertEq(usdc.balanceOf(platform), 0);
        assertEq(usdc.balanceOf(factory.predict(ID)), 100e6); // funds still sit safely
    }

    function test_domainSeparation_rescueSignatureCannotAuthorizeSweep() public {
        _exchangeSends(ID, 100e6);
        uint256 exp = block.timestamp + 10 minutes;
        bytes memory rescueSig = _signRescue(SIGNER_KEY, ID, usdc, merchant, 100e6, exp);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 0);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        factory.sweep(i, rescueSig);
    }

    function test_rescue_isNotBlockedByPause() public {
        _exchangeSends(ID, 40e6);
        vm.prank(owner);
        splitter.pause();
        uint256 exp = block.timestamp + 1 hours;
        factory.rescue(ID, usdc, merchant, 40e6, exp, _signRescue(SIGNER_KEY, ID, usdc, merchant, 40e6, exp));
        assertEq(usdc.balanceOf(merchant), 40e6);
    }

    function test_revert_rescue_toZeroAddress() public {
        _exchangeSends(ID, 40e6);
        uint256 exp = block.timestamp + 1 hours;
        bytes memory sig = _signRescue(SIGNER_KEY, ID, usdc, address(0), 40e6, exp);
        vm.expectRevert(DepositForwarder.ZeroAddress.selector);
        factory.rescue(ID, usdc, address(0), 40e6, exp, sig);
    }

    function test_noEthAccepted() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(factory).call{value: 1}("");
        assertFalse(ok);
        _exchangeSends(ID, 100e6);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(ID, 100e6, 200);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));
        (ok,) = factory.predict(ID).call{value: 1}("");
        assertFalse(ok);
    }

    // -------------------------------------------------------------------- reentrancy

    function test_reentrancy_duringSplitterPull_isBlocked() public {
        ReentrantDepositToken evil = new ReentrantDepositToken();
        ClearGatewaySplitter s = new ClearGatewaySplitter(IERC20(address(evil)), signer, platform, MAX_FEE_BPS, owner);
        DepositFactory f = new DepositFactory(s);
        ClearGatewaySplitter.PaymentIntent memory i = ClearGatewaySplitter.PaymentIntent({
            intentId: ID, merchant: merchant, payer: f.predict(ID), amount: 100e6, feeBps: 200, expiry: block.timestamp + 1 hours
        });
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(SIGNER_KEY, s.hashIntent(i));
        bytes memory sig = abi.encodePacked(r, sg, v);
        evil.mint(f.predict(ID), 100e6);
        evil.arm(f, i, sig);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        f.sweep(i, sig);
        assertFalse(s.paid(ID));
    }

    // -------------------------------------------------------------------------- fuzz

    function testFuzz_sweep_exactAmountMovesAndRemainderStays(uint256 amount, uint256 extra, uint256 feeBps, bytes32 id) public {
        amount = bound(amount, 1, 1e15);
        extra = bound(extra, 0, 1e15);
        feeBps = bound(feeBps, 0, MAX_FEE_BPS);

        _exchangeSends(id, amount + extra);
        ClearGatewaySplitter.PaymentIntent memory i = _depositIntent(id, amount, feeBps);
        factory.sweep(i, _signIntent(SIGNER_KEY, i));

        (uint256 fee, uint256 merchantAmt) = splitter.computeSplit(amount, feeBps);
        assertEq(usdc.balanceOf(merchant), merchantAmt);
        assertEq(usdc.balanceOf(platform), fee);
        assertEq(usdc.balanceOf(factory.predict(id)), extra);
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(usdc.balanceOf(address(splitter)), 0);
    }

    function testFuzz_predict_distinctIntentsNeverCollide(bytes32 a, bytes32 b) public view {
        vm.assume(a != b);
        assertTrue(factory.predict(a) != factory.predict(b));
    }
}
