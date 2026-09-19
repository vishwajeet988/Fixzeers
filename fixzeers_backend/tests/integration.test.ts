import "dotenv/config";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const configuredDatabaseUrl = process.env.DATABASE_URL;
const fixturePrefix = `qa-${Date.now()}-`;

if (testDatabaseUrl && testDatabaseUrl === configuredDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
}

type ApiResponse = {
  status: number;
  body: any;
};

let app: any;
let pool: any;
let baseUrl = "";
let httpServer: Server | undefined;

test("Twilio OTP provider sends an SMS without exposing credentials", async () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEV_OTP_LOGS = "true";
  const { createTwilioOtpDeliveryProvider } = await import("../src/services/otp");
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response("{}", { status: 201 });
  };

  const provider = createTwilioOtpDeliveryProvider(
    "AC123",
    "auth-secret",
    "+15550000000",
    fakeFetch
  );
  await provider.send("+15551111111", "123456", "phone verification");

  assert.match(requestUrl, /Accounts\/AC123\/Messages\.json$/);
  assert.equal(requestInit?.method, "POST");
  assert.equal(
    requestInit?.headers && (requestInit.headers as Record<string, string>).Authorization,
    `Basic ${Buffer.from("AC123:auth-secret").toString("base64")}`
  );
  assert.match(String(requestInit?.body), /To=%2B15551111111/);
  assert.match(String(requestInit?.body), /123456/);
});

async function loadApp() {
  process.env.DATABASE_URL = testDatabaseUrl || configuredDatabaseUrl;
  process.env.JWT_SECRET = "test-only-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEV_OTP_LOGS = "true";
  process.env.CORS_ORIGIN = "http://localhost:5500";

  const serverModule = await import("../src/server");
  const dbModule = await import("../src/db");
  app = serverModule.app;
  pool = dbModule.pool;
  httpServer = createServer(app);
  await new Promise<void>(resolve => httpServer!.listen(0, resolve));
  const address = httpServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function closeApp() {
  if (httpServer) {
    await new Promise<void>(resolve => httpServer!.close(() => resolve()));
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function captureOtp(action: () => Promise<ApiResponse>) {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    const response = await action();
    const match = lines.join("\n").match(/:\s(\d{6})\s*$/m);
    assert.ok(match, "OTP was not emitted by the test-only development logger");
    return { response, otp: match[1] };
  } finally {
    console.log = originalLog;
  }
}

let sequence = 0;
async function registerOnly(role: "customer" | "professional") {
  sequence += 1;
  const email = `${fixturePrefix}${role}-${sequence}@example.test`;
  const phone = `9${String(Date.now()).slice(-8)}${sequence}`;
  const password = "Strong-password-123";
  const registered = await request("POST", "/api/auth/register", {
    name: `${role} QA ${sequence}`,
    phone,
    email,
    password,
    role
  });
  assert.equal(registered.status, 201);
  return { email, phone, password, user: registered.body.user };
}

async function registerAndVerify(role: "customer" | "professional") {
  const account = await registerOnly(role);
  const { email, phone, password } = account;
  const otpRequest = await captureOtp(() =>
    request("POST", "/api/auth/request-otp", { phone })
  );
  assert.equal(otpRequest.response.status, 200);

  const verified = await request("POST", "/api/auth/verify-otp", {
    phone,
    otp: otpRequest.otp
  });
  assert.equal(verified.status, 200);
  return { ...verified.body, email, phone, password, phoneOtp: otpRequest.otp };
}

async function prepareDatabase() {
  // This database is explicitly supplied via TEST_DATABASE_URL and is safe to reset.
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

async function cleanupFixtures() {
  const users = "SELECT id FROM users WHERE email LIKE $1";
  await pool.query(`DELETE FROM job_events WHERE job_id IN (
    SELECT id FROM jobs WHERE customer_id IN (${users}) OR professional_id IN (${users})
  )`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM reviews WHERE customer_id IN (${users}) OR professional_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM jobs WHERE customer_id IN (${users}) OR professional_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM reputation_scores WHERE professional_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM verification_records WHERE professional_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM phone_otp_challenges WHERE user_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM password_reset_challenges WHERE user_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query(`DELETE FROM professional_profiles WHERE user_id IN (${users})`, [`${fixturePrefix}%`]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`${fixturePrefix}%`]);
}

test("malformed JSON returns 400", async () => {
  await loadApp();
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"identifier":"broken"'
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Malformed JSON request body"
    });

    const corsResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "http://localhost:5500" }
    });
    assert.equal(corsResponse.headers.get("access-control-allow-origin"), "http://localhost:5500");
    assert.equal(corsResponse.headers.get("access-control-allow-credentials"), "true");
  } finally {
    await closeApp();
  }
});

test(
  "isolated authentication, authorization, jobs, reviews, and reputation",
  { skip: !testDatabaseUrl },
  async () => {
    await loadApp();
    try {
      await prepareDatabase();
      const customer = await registerAndVerify("customer");
      const professional = await registerAndVerify("professional");
      const secondCustomer = await registerAndVerify("customer");
      assert.equal((await request("POST", "/api/auth/login", {
        identifier: customer.email,
        password: customer.password
      })).status, 200);
      assert.equal((await request("POST", "/api/auth/login", {
        identifier: professional.email,
        password: professional.password
      })).status, 200);
      assert.equal((await request("POST", "/api/auth/verify-otp", {
        phone: professional.phone,
        otp: professional.phoneOtp
      })).status, 400);

      const categories = await request("GET", "/api/categories");
      assert.equal(categories.status, 200);
      assert.ok(categories.body.categories.length >= 2);

      assert.equal((await request("GET", "/api/professionals/not-a-uuid")).status, 400);
      assert.equal((await request("GET", "/api/professionals/00000000-0000-0000-0000-000000000000")).status, 404);

      const [category, wrongCategory] = categories.body.categories;

      const profile = await request(
        "PUT",
        "/api/professionals/profile/me",
        {
          categoryId: category.id,
          bio: "QA professional",
          yearsExperience: 5,
          serviceArea: "Bhopal",
          availability: "Weekdays",
          skills: ["testing"],
          portfolioUrls: ["https://example.test/portfolio"],
          referencesText: ["QA reference"]
        },
        professional.token
      );
      assert.equal(profile.status, 200);

      const wrongRoleProfile = await request(
        "PUT",
        "/api/professionals/profile/me",
        { bio: "not allowed" },
        customer.token
      );
      assert.equal(wrongRoleProfile.status, 403);

      const mismatch = await request("POST", "/api/jobs", {
        professionalId: professional.user.id,
        categoryId: wrongCategory.id,
        title: "Mismatched category"
      }, customer.token);
      assert.equal(mismatch.status, 400);

      const jobResponse = await request("POST", "/api/jobs", {
        professionalId: professional.user.id,
        categoryId: category.id,
        title: "Repair appliance",
        description: "Integration fixture"
      }, customer.token);
      assert.equal(jobResponse.status, 201);
      const jobId = jobResponse.body.job.id;

      assert.equal((await request("GET", `/api/jobs/${jobId}`, undefined, secondCustomer.token)).status, 403);
      assert.equal((await request("PATCH", `/api/jobs/${jobId}/status`, { status: "accepted" }, customer.token)).status, 403);
      assert.equal((await request("PATCH", `/api/jobs/${jobId}/status`, { status: "accepted" }, professional.token)).status, 200);
      for (const status of ["scheduled", "arrived", "in_progress", "completed"]) {
        assert.equal((await request("PATCH", `/api/jobs/${jobId}/status`, { status }, professional.token)).status, 200);
      }
      assert.equal((await request("PATCH", `/api/jobs/${jobId}/status`, { status: "customer_confirmed" }, professional.token)).status, 403);
      const confirmed = await request("PATCH", `/api/jobs/${jobId}/status`, { status: "customer_confirmed" }, customer.token);
      assert.equal(confirmed.status, 200);
      assert.ok(confirmed.body.reputation);

      assert.equal((await request("POST", `/api/reviews/${jobId}`, { rating: 6, comment: "bad" }, customer.token)).status, 400);
      assert.equal((await request("POST", `/api/reviews/${jobId}`, { rating: 5, comment: "good" }, professional.token)).status, 403);
      assert.equal((await request("POST", `/api/reviews/${jobId}`, { rating: 5, comment: "good" }, customer.token)).status, 201);
      assert.equal((await request("POST", `/api/reviews/${jobId}`, { rating: 5, comment: "duplicate" }, customer.token)).status, 409);

      const resetOtp = await captureOtp(() => request("POST", "/api/auth/request-password-reset", { identifier: customer.email }));
      assert.equal(resetOtp.response.status, 200);
      assert.equal((await request("POST", "/api/auth/reset-password", { identifier: customer.email, otp: resetOtp.otp, newPassword: "New-password-456" })).status, 200);
      assert.equal((await request("POST", "/api/auth/reset-password", { identifier: customer.email, otp: resetOtp.otp, newPassword: "New-password-789" })).status, 400);
      assert.equal((await request("POST", "/api/auth/login", { identifier: customer.email, password: "New-password-456" })).status, 200);
      assert.equal((await request("POST", "/api/auth/login", { identifier: customer.email, password: customer.password })).status, 401);

      const expiryUser = await registerOnly("customer");
      const expiryOtp = await captureOtp(() => request("POST", "/api/auth/request-otp", { phone: expiryUser.phone }));
      await pool.query("UPDATE phone_otp_challenges SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1", [expiryUser.user.id]);
      assert.equal((await request("POST", "/api/auth/verify-otp", { phone: expiryUser.phone, otp: expiryOtp.otp })).status, 400);

      const limitedUser = await registerOnly("customer");
      await captureOtp(() => request("POST", "/api/auth/request-otp", { phone: limitedUser.phone }));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal((await request("POST", "/api/auth/verify-otp", { phone: limitedUser.phone, otp: "000000" })).status, 400);
      }
      assert.equal((await request("POST", "/api/auth/verify-otp", { phone: limitedUser.phone, otp: "000000" })).status, 429);
    } finally {
      await cleanupFixtures();
      await closeApp();
      await pool.end();
    }
  }
);
