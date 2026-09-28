import { setupTestDatabase } from "@belk/db/testing";

// Runs once: creates + migrates a throwaway database for this package's integration tests.
export default async function setup() {
  process.env.TEST_DATABASE_URL = await setupTestDatabase("belkpay_test_api");
}
