import { setupTestDatabase } from "@belk/db/testing";

// Creates + migrates a throwaway database for the worker's integration / E2E tests.
export default async function setup() {
  process.env.TEST_DATABASE_URL = await setupTestDatabase("belkpay_test_worker");
}
