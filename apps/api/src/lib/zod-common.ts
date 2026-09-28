import { getAddress, isAddress } from "viem";
import { z } from "zod";

/** EVM address: all-lowercase/uppercase or a correct EIP-55 checksum; normalized to the checksummed form. */
export const evmAddress = z
  .string()
  .refine((v) => isAddress(v, { strict: true }), "must be a valid EVM address (mixed-case addresses must have a correct checksum)")
  .transform((v) => getAddress(v));

/** Integer string in USDC base units (6 decimals). Never a JSON number. */
export const unitsString = z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive integer string in USDC base units");

export const paginationQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  starting_after: z.string().min(1).max(100).optional(),
};
