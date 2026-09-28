/**
 * On-ramps require the destination wallet to belong to the buyer, so it must never be a merchant's payout wallet,
 * our splitter, or the USDC token contract — any of those would make the on-ramp send funds somewhere the customer
 * doesn't control, which real providers reject and which we must never even attempt.
 */
export function assertSafeCustomerWallet(
  customerWalletAddress: string,
  forbidden: { merchantPayoutWallet: string; splitterAddress: string; usdcAddress: string },
): void {
  const lower = (a: string) => a.toLowerCase();
  const wallet = lower(customerWalletAddress);
  const clashes: [string, string][] = [
    ["merchant's payout wallet", forbidden.merchantPayoutWallet],
    ["splitter contract", forbidden.splitterAddress],
    ["USDC token contract", forbidden.usdcAddress],
  ];
  for (const [label, address] of clashes) {
    if (wallet === lower(address)) {
      throw new Error(`customerWalletAddress must belong to the customer; it cannot be the ${label}`);
    }
  }
}
