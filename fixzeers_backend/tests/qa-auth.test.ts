import "dotenv/config";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

const allowlistedPhone = "+15551111111";
const blockedPhone = "+15552222222";
const fixturePrefix = `qa-route-${Date.now()}-`;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const configuredDatabaseUrl = process.env.DATABASE_URL;

if (testDatabaseUrl && testDatabaseUrl === configuredDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
}

process.env.NODE_ENV = "development";
process.env.OTP_PROVIDER = "qa";
process.env.QA_OTP_ENABLED = "true";
process.env.QA_OTP_PHONE_NUMBERS = allowlistedPhone;
process.env.ENABLE_DEV_OTP_LOGS = "false";
process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
process.env.OTP_HASH_SECRET = "test-only-otp-hash-secret-with-at-least-32";
process.env.CORS_ORIGIN = "http://localhost:5500";
process.env.DATABASE_URL = testDatabaseUrl || configuredDatabaseUrl;

let baseUrl = "";
let pool: any;
let httpServer: Server | undefined;
const logLines: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => logLines.push(args.join(" "));

type ApiResponse = { status: number; body: any };

async function request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function prepareDatabase() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const root = join(__dirname, "..");
  for (const file of [
    "database/schema.sql",
    "migration/001_indexes_and_constraints.sql",
    "migration/002_role_integrity.sql",
    "migration/003_phone_otp.sql",
    "migration/004_password_reset.sql",
    "migration/005_user_city.sql",
    "migration/006_professional_skills.sql"
  ]) {
    await pool.query(await readFile(join(root, file), "utf8"));
  }
}

async function register(phone: string, suffix: string) {
  const response = await request("POST", "/api/auth/register", {
    name: `QA Route ${suffix}`,
    phone,
    email: `${fixturePrefix}${suffix}@example.test`,
    password: "Strong-password-123",
    role: "customer"
  });
  assert.equal(response.status, 201);
  return response.body.user;
}

test("QA OTP auth routes enforce the allowlist without reset enumeration", async () => {
  try {
    const serverModule = await import("../src/server");
    const dbModule = await import("../src/db");
    pool = dbModule.pool;
    await new Promise<void>(resolve => {
      httpServer = createServer(serverModule.app).listen(0, resolve);
    });
    const address = httpServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    await prepareDatabase();

    const allowlistedUser = await register(allowlistedPhone, "allowlisted");
    const blockedUser = await register(blockedPhone, "blocked");
    const storedBlockedUser = await pool.query(
      "SELECT phone, phone_verified FROM users WHERE id = $1",
      [blockedUser.id]
    );
    assert.equal(storedBlockedUser.rows[0].phone, blockedPhone);
    assert.equal(storedBlockedUser.rows[0].phone_verified, false);

    logLines.length = 0;
    const allowedRequest = await request("POST", "/api/auth/request-otp", {
      phone: allowlistedPhone
    });
    assert.equal(allowedRequest.status, 200);
    const otpLog = logLines.find(line => line.includes("[QA OTP]"));
    assert.ok(otpLog);
    const otp = otpLog.match(/:\s(\d{6})$/)?.[1];
    assert.ok(otp);

    const blockedRequest = await request("POST", "/api/auth/request-otp", {
      phone: blockedPhone
    });
    assert.equal(blockedRequest.status, 200);
    assert.deepEqual(blockedRequest.body, {
      message: "If the phone number is registered, an OTP has been generated."
    });
    assert.equal(logLines.filter(line => line.includes("[QA OTP]")).length, 1);

    const allowedVerification = await request("POST", "/api/auth/verify-otp", {
      phone: allowlistedPhone,
      otp
    });
    assert.equal(allowedVerification.status, 200);

    await pool.query("UPDATE users SET phone_verified = TRUE WHERE id = $1", [blockedUser.id]);
    const blockedReset = await request("POST", "/api/auth/request-password-reset", {
      identifier: blockedPhone
    });
    assert.equal(blockedReset.status, 200);
    assert.deepEqual(blockedReset.body, {
      message: "If the account exists, a password reset OTP has been generated."
    });

    const allowedReset = await request("POST", "/api/auth/request-password-reset", {
      identifier: allowlistedPhone
    });
    assert.equal(allowedReset.status, 200);
    assert.equal(logLines.filter(line => line.includes("[QA OTP]")).length, 2);
    assert.ok(allowlistedUser.id);
  } finally {
    if (pool) {
      await pool.query("DELETE FROM phone_otp_challenges WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [`${fixturePrefix}%`]);
      await pool.query("DELETE FROM password_reset_challenges WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [`${fixturePrefix}%`]);
      await pool.query("DELETE FROM users WHERE email LIKE $1", [`${fixturePrefix}%`]);
      await pool.end();
    }
    if (httpServer) {
      await new Promise<void>(resolve => httpServer!.close(() => resolve()));
    }
    console.log = originalLog;
  }
});
