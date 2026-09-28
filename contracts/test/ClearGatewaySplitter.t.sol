// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ClearGatewaySplitter} from "../src/ClearGatewaySplitter.sol";
import {Fixtures} from "./Fixtures.sol";

/// @dev Token that tries to re-enter the splitter during transferFrom / receiveWithAuthorization.
contract ReentrantToken is ERC20 {
    ClearGatewaySplitter public target;
    ClearGatewaySplitter.PaymentIntent internal intent;
    bytes internal sig;

    constructor() ERC20("Evil", "EVIL") {}

    function arm(ClearGatewaySplitter t, ClearGatewaySplitter.PaymentIntent memory i, bytes memory s) external {
        target = t;
        intent = i;
        sig = s;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public override returns (bool) {
        target.pay(intent, sig); // must revert with ReentrancyGuardReentrantCall
        return true;
    }

    function receiveWithAuthorization(address, address, uint256, uint256, uint256, bytes32, bytes memory) external {
        target.pay(intent, sig);
    }
}

contract ClearGatewaySplitterTest is Fixtures {
    bytes32 internal constant ID = keccak256("pi_test_1");

    function setUp() public {
        _deploy();
        usdc.mint(payer, 1_000_000e6);
        vm.prank(payer);
        usdc.approve(address(splitter), type(uint256).max);
    }

    // ------------------------------------------------------------- happy paths

    function test_pay_splitsInOneTx() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);

        vm.expectEmit(true, true, true, true, address(splitter));
        emit ClearGatewaySplitter.PaymentSettled(ID, payer, merchant, 100e6, 2e6);
        vm.prank(payer);
        splitter.pay(i, sig);

        assertEq(usdc.balanceOf(merchant), 98e6);
        assertEq(usdc.balanceOf(platform), 2e6);
        assertEq(usdc.balanceOf(address(splitter)), 0);
        assertTrue(splitter.paid(ID));
    }

    function test_payWithAuthorization_splitsInOneTx_relayerSubmits() public {
        // No approval on this path.
        vm.prank(payer);
        usdc.approve(address(splitter), 0);

        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _authFor(i, block.timestamp + 1 hours);

        vm.expectEmit(true, true, true, true, address(splitter));
        emit ClearGatewaySplitter.PaymentSettled(ID, payer, merchant, 100e6, 2e6);
        vm.prank(relayer);
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);

        assertEq(usdc.balanceOf(merchant), 98e6);
        assertEq(usdc.balanceOf(platform), 2e6);
        assertEq(usdc.balanceOf(address(splitter)), 0);
        assertTrue(splitter.paid(ID));
    }

    function test_zeroFee_allToMerchant() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 50e6, 0);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        splitter.pay(i, sig);
        assertEq(usdc.balanceOf(merchant), 50e6);
        assertEq(usdc.balanceOf(platform), 0);
    }

    // -------------------------------------------------------------- signatures

    function test_revert_wrongSigner() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(0xBAD, i);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sig);
    }

    function test_revert_garbageSignature() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        vm.prank(payer);
        vm.expectRevert(); // OZ ECDSAInvalidSignatureLength
        splitter.pay(i, hex"1234");
    }

    function test_revert_tamperedAmount() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.amount = 1e6;
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sig);
    }

    function test_revert_tamperedMerchant() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.merchant = attacker;
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sig);
    }

    function test_revert_tamperedFee() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.feeBps = 0; // within cap, but not what was signed
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sig);
    }

    function test_revert_tamperedIntentId() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.intentId = keccak256("other");
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sig);
    }

    function test_revert_tamperedPayer_authPath() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        i.payer = attacker;
        vm.prank(relayer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, hex"");
    }

    function test_revert_callerNotSignedPayer() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(attacker);
        vm.expectRevert(ClearGatewaySplitter.NotPayer.selector);
        splitter.pay(i, sig);
    }

    function test_signatureBoundToThisContractAndChain() public {
        // Same terms signed for a second deployment must not validate on the first.
        ClearGatewaySplitter other = new ClearGatewaySplitter(usdc, signer, platform, MAX_FEE_BPS, owner);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, other.hashIntent(i));
        bytes memory sigForOther = abi.encodePacked(r, s, v);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, sigForOther);
    }

    // ------------------------------------------------------- expiry / replay / cap

    function test_revert_expired() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.warp(i.expiry + 1);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.IntentExpired.selector);
        splitter.pay(i, sig);
    }

    function test_validAtExactExpiry() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.warp(i.expiry);
        vm.prank(payer);
        splitter.pay(i, sig);
        assertTrue(splitter.paid(ID));
    }

    function test_revert_doublePayment_samePath() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.startPrank(payer);
        splitter.pay(i, sig);
        vm.expectRevert(ClearGatewaySplitter.IntentAlreadyPaid.selector);
        splitter.pay(i, sig);
        vm.stopPrank();
    }

    function test_revert_doublePayment_acrossPaths() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _authFor(i, block.timestamp + 1 hours);
        vm.prank(payer);
        splitter.pay(i, sig);
        vm.prank(relayer);
        vm.expectRevert(ClearGatewaySplitter.IntentAlreadyPaid.selector);
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
    }

    function test_revert_feeAboveCap_evenIfSigned() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, MAX_FEE_BPS + 1);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.FeeTooHigh.selector);
        splitter.pay(i, sig);
    }

    function test_feeAtCap_ok() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, MAX_FEE_BPS);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        splitter.pay(i, sig);
        assertEq(usdc.balanceOf(platform), 10e6);
    }

    function test_revert_zeroAmount_zeroMerchant() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 0, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.ZeroAmount.selector);
        splitter.pay(i, sig);

        i = _intent(ID, 1e6, 200);
        i.merchant = address(0);
        sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        splitter.pay(i, sig);
    }

    function test_revert_insufficientBalanceOrAllowance_leavesIntentUnpaid() public {
        vm.prank(payer);
        usdc.approve(address(splitter), 0);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        vm.expectRevert(); // ERC20InsufficientAllowance
        splitter.pay(i, sig);
        assertFalse(splitter.paid(ID)); // whole tx reverted, so retry is possible
    }

    // ------------------------------------------------------------- EIP-3009 path

    function test_revert_auth_signedForDifferentValue() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _signAuth(PAYER_KEY, payer, address(splitter), 1e6, 0, block.timestamp + 1 hours, ID);
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
    }

    function test_revert_auth_signedForDifferentPayee() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _signAuth(PAYER_KEY, payer, attacker, 100e6, 0, block.timestamp + 1 hours, ID);
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
    }

    function test_revert_auth_nonceMustBeIntentId() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _signAuth(PAYER_KEY, payer, address(splitter), 100e6, 0, block.timestamp + 1 hours, keccak256("x"));
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
    }

    function test_frontRun_attackerCannotRedirectAuthorization() public {
        // The payer's authorization names the splitter as payee. USDC only lets the payee submit it,
        // so an attacker cannot consume it to move funds anywhere else.
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory auth = _authFor(i, block.timestamp + 1 hours);
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        usdc.receiveWithAuthorization(payer, address(splitter), 100e6, 0, block.timestamp + 1 hours, ID, auth);
    }

    // -------------------------------------------------------------------- pause

    function test_paused_blocksBothPaths_unpauseRestores() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        bytes memory auth = _authFor(i, block.timestamp + 1 hours);

        vm.prank(owner);
        splitter.pause();

        vm.prank(payer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        splitter.pay(i, sig);
        vm.prank(relayer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);

        vm.prank(owner);
        splitter.unpause();
        vm.prank(payer);
        splitter.pay(i, sig);
        assertTrue(splitter.paid(ID));
    }

    // -------------------------------------------------------------------- admin

    function test_admin_rotateSigner() public {
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory oldSig = _signIntent(SIGNER_KEY, i);
        uint256 newKey = 0xC0FFEE;
        vm.prank(owner);
        splitter.setSigner(vm.addr(newKey));

        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.InvalidSignature.selector);
        splitter.pay(i, oldSig);

        bytes memory newSig = _signIntent(newKey, i);
        vm.prank(payer);
        splitter.pay(i, newSig);
        assertTrue(splitter.paid(ID));
    }

    function test_admin_changePlatformWallet() public {
        address newWallet = makeAddr("newPlatform");
        vm.prank(owner);
        splitter.setPlatformWallet(newWallet);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        splitter.pay(i, sig);
        assertEq(usdc.balanceOf(newWallet), 2e6);
        assertEq(usdc.balanceOf(platform), 0);
    }

    function test_admin_changeMaxFee() public {
        vm.prank(owner);
        splitter.setMaxFeeBps(500);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 501);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        vm.prank(payer);
        vm.expectRevert(ClearGatewaySplitter.FeeTooHigh.selector);
        splitter.pay(i, sig);

        vm.prank(owner);
        vm.expectRevert(ClearGatewaySplitter.InvalidMaxFeeBps.selector);
        splitter.setMaxFeeBps(10_001);
    }

    function test_admin_onlyOwner() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker);
        vm.startPrank(attacker);
        vm.expectRevert(unauthorized);
        splitter.setSigner(attacker);
        vm.expectRevert(unauthorized);
        splitter.setPlatformWallet(attacker);
        vm.expectRevert(unauthorized);
        splitter.setMaxFeeBps(1);
        vm.expectRevert(unauthorized);
        splitter.pause();
        vm.expectRevert(unauthorized);
        splitter.unpause();
        vm.stopPrank();
    }

    function test_admin_zeroAddressesRejected() public {
        vm.startPrank(owner);
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        splitter.setSigner(address(0));
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        splitter.setPlatformWallet(address(0));
        vm.stopPrank();
    }

    function test_admin_twoStepOwnership_andNoRenounce() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        splitter.transferOwnership(newOwner);
        assertEq(splitter.owner(), owner); // not yet transferred
        vm.prank(newOwner);
        splitter.acceptOwnership();
        assertEq(splitter.owner(), newOwner);

        vm.prank(newOwner);
        vm.expectRevert(ClearGatewaySplitter.RenounceDisabled.selector);
        splitter.renounceOwnership();
    }

    function test_constructor_validation() public {
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        new ClearGatewaySplitter(IERC20(address(0)), signer, platform, 1000, owner);
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        new ClearGatewaySplitter(usdc, address(0), platform, 1000, owner);
        vm.expectRevert(ClearGatewaySplitter.ZeroAddress.selector);
        new ClearGatewaySplitter(usdc, signer, address(0), 1000, owner);
        vm.expectRevert(ClearGatewaySplitter.InvalidMaxFeeBps.selector);
        new ClearGatewaySplitter(usdc, signer, platform, 10_001, owner);
    }

    // ------------------------------------------------------ fee math (matches TS)

    /// @dev Same vectors as packages/shared/src/money.test.ts.
    function test_feeRounding_matchesTypeScriptVectors() public view {
        (uint256 f, uint256 m) = splitter.computeSplit(100e6, 200);
        assertEq(f, 2e6);
        assertEq(m, 98e6);
        (f, m) = splitter.computeSplit(1, 200);
        assertEq(f, 0);
        assertEq(m, 1);
        (f, m) = splitter.computeSplit(999_999, 250);
        assertEq(f, 24_999);
        assertEq(m, 975_000);
        (f, m) = splitter.computeSplit(1e6, 1000);
        assertEq(f, 100_000);
        assertEq(m, 900_000);
        (f, m) = splitter.computeSplit(1e6, 0);
        assertEq(f, 0);
        assertEq(m, 1e6);
        (f, m) = splitter.computeSplit(10 ** 30, 1000);
        assertEq(f, 10 ** 29);
        assertEq(m, 9 * 10 ** 29);
    }

    // --------------------------------------------------------------- reentrancy

    function test_reentrancy_viaTransferFrom_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        ClearGatewaySplitter s = new ClearGatewaySplitter(IERC20(address(evil)), signer, platform, MAX_FEE_BPS, owner);
        evil.mint(payer, 1000e6);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(SIGNER_KEY, s.hashIntent(i));
        bytes memory sig = abi.encodePacked(r, sg, v);
        evil.arm(s, i, sig);

        vm.prank(payer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        s.pay(i, sig);
        assertFalse(s.paid(ID));
    }

    function test_reentrancy_viaAuthorization_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        ClearGatewaySplitter s = new ClearGatewaySplitter(IERC20(address(evil)), signer, platform, MAX_FEE_BPS, owner);
        ClearGatewaySplitter.PaymentIntent memory i = _intent(ID, 100e6, 200);
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(SIGNER_KEY, s.hashIntent(i));
        bytes memory sig = abi.encodePacked(r, sg, v);
        evil.arm(s, i, sig);

        vm.prank(relayer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        s.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, hex"");
        assertFalse(s.paid(ID));
    }

    // --------------------------------------------------------------------- fuzz

    function testFuzz_computeSplit_partsSumToTotal(uint256 amount, uint256 feeBps) public view {
        amount = bound(amount, 1, type(uint128).max);
        feeBps = bound(feeBps, 0, 10_000);
        (uint256 fee, uint256 merchantAmt) = splitter.computeSplit(amount, feeBps);
        assertEq(fee + merchantAmt, amount);
        assertEq(fee, (amount * feeBps) / 10_000);
        assertLe(fee, amount);
    }

    function testFuzz_pay_balancesMatchAndContractEmpty(uint256 amount, uint256 feeBps, bool useAuth) public {
        amount = bound(amount, 1, 1e15); // up to 1 billion USDC
        feeBps = bound(feeBps, 0, MAX_FEE_BPS);
        usdc.mint(payer, amount);

        ClearGatewaySplitter.PaymentIntent memory i = _intent(keccak256(abi.encode(amount, feeBps, useAuth)), amount, feeBps);
        bytes memory sig = _signIntent(SIGNER_KEY, i);
        uint256 payerBefore = usdc.balanceOf(payer);

        if (useAuth) {
            bytes memory auth = _authFor(i, block.timestamp + 1 hours);
            vm.prank(relayer);
            splitter.payWithAuthorization(i, sig, 0, block.timestamp + 1 hours, auth);
        } else {
            vm.prank(payer);
            splitter.pay(i, sig);
        }

        (uint256 fee, uint256 merchantAmt) = splitter.computeSplit(amount, feeBps);
        assertEq(usdc.balanceOf(merchant), merchantAmt);
        assertEq(usdc.balanceOf(platform), fee);
        assertEq(usdc.balanceOf(address(splitter)), 0);
        assertEq(payerBefore - usdc.balanceOf(payer), amount);
    }
}
