/** The only chain read the checkout API needs: the current block, to record where deposit-address scanning may start. */
export interface ChainBlockReader {
  getBlockNumber(): Promise<bigint>;
}
