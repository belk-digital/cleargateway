import { setupTestDatabase } from "./src/testing.js";

// Runs once before all test files in this package. The URL is handed to tests via env.
export default async function setup() {
  process.env.TEST_DATABASE_URL = await setupTestDatabase("belkpay_test_db");
}
