import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { query } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { AuthRequest } from "../types";
import { otpDeliveryProvider } from "../services/otp";

const router = Router();

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later."
  }
});

const otpRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many OTP requests. Please try again later."
  }
});

const otpVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many OTP verification attempts. Please try again later."
  }
});

const passwordResetRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password reset requests. Please try again later."
  }
});

const passwordResetVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password reset attempts. Please try again later."
  }
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().optional(),
  password: z.string().min(8).max(100),
  role: z.enum(["customer", "professional"]).default("customer"),
  city: z.string().trim().max(100).optional()
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(8)
});

const requestOtpSchema = z.object({
  phone: z.string().trim().min(10).max(20)
});

const verifyOtpSchema = z.object({
  phone: z.string().trim().min(10).max(20),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits")
});

const requestPasswordResetSchema = z.object({
  identifier: z.string().trim().min(1).max(255)
});

const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits"),
  newPassword: z.string().min(8).max(100)
});

function signToken(id: string, role: string) {
  return jwt.sign(
    { id, role },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otp: string): string {
  return crypto
    .createHmac("sha256", config.otpHashSecret)
    .update(otp)
    .digest("hex");
}

function safeOtpCompare(
  suppliedHash: string,
  storedHash: string
): boolean {
  const supplied = Buffer.from(suppliedHash, "hex");
  const stored = Buffer.from(storedHash, "hex");

  if (supplied.length !== stored.length) {
    return false;
  }

  return crypto.timingSafeEqual(supplied, stored);
}

/*
 * REGISTER
 *
 * New accounts start with phone_verified = false.
 * The user must verify their phone before login.
 */
router.post(
  "/register",
  authRateLimit,
  async (req, res, next) => {
    try {
      const data = registerSchema.parse(req.body);

      const hash = await bcrypt.hash(data.password, 12);

      const result = await query<any>(
        `INSERT INTO users(
           name,
           phone,
           email,
           password_hash,
           role,
           city,
           phone_verified
         )
         VALUES($1,$2,$3,$4,$5,$6,FALSE)
         RETURNING
           id,
           name,
           phone,
           email,
           city,
           role,
           phone_verified`,
        [
          data.name,
          data.phone,
          data.email ?? null,
          hash,
          data.role,
          data.city ?? null
        ]
      );

      const user = result.rows[0];

      if (data.role === "professional") {
        await query(
          `INSERT INTO professional_profiles(user_id)
           VALUES($1)
           ON CONFLICT(user_id) DO NOTHING`,
          [user.id]
        );

        await query(
          `INSERT INTO reputation_scores(professional_id)
           VALUES($1)
           ON CONFLICT DO NOTHING`,
          [user.id]
        );
      }

      return res.status(201).json({
        user,
        message:
          "Registration successful. Please verify your phone number with OTP."
      });
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({
          error: "Phone or email already registered"
        });
      }

      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid registration data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * REQUEST PHONE OTP
 *
 * Development uses the configured console provider. Production uses Twilio.
 */
router.post(
  "/request-otp",
  otpRequestRateLimit,
  async (req, res, next) => {
    try {
      const data = requestOtpSchema.parse(req.body);

      const userResult = await query<any>(
        `SELECT
           id,
           phone,
           phone_verified
         FROM users
         WHERE phone = $1
         LIMIT 1`,
        [data.phone]
      );

      const user = userResult.rows[0];

      // Do not reveal whether a phone number exists.
      if (!user) {
        return res.json({
          message:
            "If the phone number is registered, an OTP has been generated."
        });
      }

      if (user.phone_verified) {
        return res.json({
          message: "Phone number is already verified."
        });
      }

      // Invalidate previous unused OTPs.
      await query(
        `UPDATE phone_otp_challenges
         SET consumed_at = NOW()
         WHERE user_id = $1
           AND consumed_at IS NULL`,
        [user.id]
      );

      const otp = generateOtp();
      const otpHash = hashOtp(otp);

      await query(
        `INSERT INTO phone_otp_challenges(
           user_id,
           otp_hash,
           expires_at,
           attempts,
           max_attempts
         )
         VALUES(
           $1,
           $2,
           NOW() + INTERVAL '10 minutes',
           0,
           5
         )`,
        [user.id, otpHash]
      );

      await otpDeliveryProvider.send(user.phone, otp, "phone verification");

      return res.json({
        message:
          "If the phone number is registered, an OTP has been generated."
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid phone number",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * VERIFY PHONE OTP
 */
router.post(
  "/verify-otp",
  otpVerifyRateLimit,
  async (req, res, next) => {
    try {
      const data = verifyOtpSchema.parse(req.body);

      const userResult = await query<any>(
        `SELECT
           id,
           name,
           phone,
           email,
           city,
           role,
           phone_verified
         FROM users
         WHERE phone = $1
         LIMIT 1`,
        [data.phone]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      const otpResult = await query<any>(
        `SELECT
           id,
           otp_hash,
           expires_at,
           attempts,
           max_attempts,
           consumed_at
          FROM phone_otp_challenges
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [user.id]
      );

      const challenge = otpResult.rows[0];
      const suppliedHash = hashOtp(data.otp);

      if (user.phone_verified) {
        if (
          challenge?.consumed_at &&
          safeOtpCompare(suppliedHash, challenge.otp_hash)
        ) {
          return res.status(400).json({
            error: "Invalid or expired OTP"
          });
        }

        return res.json({
          message: "Phone number is already verified.",
          user
        });
      }

      if (!challenge || challenge.consumed_at) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      if (
        new Date(challenge.expires_at).getTime() <=
        Date.now()
      ) {
        await query(
          `UPDATE phone_otp_challenges
           SET consumed_at = NOW()
           WHERE id = $1`,
          [challenge.id]
        );

        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      if (
        challenge.attempts >=
        challenge.max_attempts
      ) {
        await query(
          `UPDATE phone_otp_challenges
           SET consumed_at = NOW()
           WHERE id = $1`,
          [challenge.id]
        );

        return res.status(429).json({
          error:
            "Too many incorrect OTP attempts. Please request a new OTP."
        });
      }

      if (
        !safeOtpCompare(
          suppliedHash,
          challenge.otp_hash
        )
      ) {
        const attemptResult = await query(
          `UPDATE phone_otp_challenges
           SET attempts = attempts + 1
           WHERE id = $1
           RETURNING attempts, max_attempts`,
          [challenge.id]
        );

        const attempts =
          attemptResult.rows[0]?.attempts ?? 0;

        if (
          attempts >= challenge.max_attempts
        ) {
          await query(
            `UPDATE phone_otp_challenges
             SET consumed_at = NOW()
             WHERE id = $1`,
            [challenge.id]
          );
        }

        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      const consumedOtp = await query(
        `UPDATE phone_otp_challenges
         SET consumed_at = NOW()
         WHERE id = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
           AND attempts < max_attempts
           AND otp_hash = $2
         RETURNING id`,
        [challenge.id, suppliedHash]
      );

      if (!consumedOtp.rows[0]) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      const updatedUser = await query<any>(
        `UPDATE users
         SET phone_verified = TRUE
         WHERE id = $1
         RETURNING
           id,
           name,
           phone,
           email,
           city,
           role,
           phone_verified`,
        [user.id]
      );

      return res.json({
        message:
          "Phone number verified successfully.",
        user: updatedUser.rows[0],
        token: signToken(
          user.id,
          user.role
        )
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid OTP data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * REQUEST PASSWORD RESET OTP
 *
 * Accepts either phone number or email.
 * The response intentionally does not reveal whether
 * the account exists.
 */
router.post(
  "/request-password-reset",
  passwordResetRequestRateLimit,
  async (req, res, next) => {
    try {
      const data =
        requestPasswordResetSchema.parse(req.body);

      const identifier =
        data.identifier.trim();

      const userResult = await query<any>(
        `SELECT
           id,
           phone,
           email,
           phone_verified
         FROM users
         WHERE phone = $1
            OR (
              email IS NOT NULL
              AND LOWER(email) = LOWER($1)
            )
         LIMIT 1`,
        [identifier]
      );

      const user = userResult.rows[0];

      // Always return the same public response.
      if (!user) {
        return res.json({
          message:
            "If the account exists, a password reset OTP has been generated."
        });
      }

      /*
       * Password recovery is tied to a verified phone.
       * This prevents an unverified phone number from
       * being used as a recovery channel.
       */
      if (!user.phone_verified) {
        return res.json({
          message:
            "If the account exists, a password reset OTP has been generated."
        });
      }

      await query(
        `UPDATE password_reset_challenges
         SET consumed_at = NOW()
         WHERE user_id = $1
           AND consumed_at IS NULL`,
        [user.id]
      );

      const otp = generateOtp();
      const otpHash = hashOtp(otp);

      await query(
        `INSERT INTO password_reset_challenges(
           user_id,
           otp_hash,
           expires_at,
           attempts,
           max_attempts
         )
         VALUES(
           $1,
           $2,
           NOW() + INTERVAL '10 minutes',
           0,
           5
         )`,
        [user.id, otpHash]
      );

      await otpDeliveryProvider.send(user.phone, otp, "password reset");

      return res.json({
        message:
          "If the account exists, a password reset OTP has been generated."
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid recovery identifier",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * RESET PASSWORD
 *
 * Verifies the reset OTP and changes the password
 * in the same request.
 */
router.post(
  "/reset-password",
  passwordResetVerifyRateLimit,
  async (req, res, next) => {
    try {
      const data =
        resetPasswordSchema.parse(req.body);

      const identifier =
        data.identifier.trim();

      const userResult = await query<any>(
        `SELECT
           id,
           role,
           phone_verified
         FROM users
         WHERE phone = $1
            OR (
              email IS NOT NULL
              AND LOWER(email) = LOWER($1)
            )
         LIMIT 1`,
        [identifier]
      );

      const user = userResult.rows[0];

      if (!user || !user.phone_verified) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      const challengeResult = await query<any>(
        `SELECT
           id,
           otp_hash,
           expires_at,
           attempts,
           max_attempts
         FROM password_reset_challenges
         WHERE user_id = $1
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
      );

      const challenge =
        challengeResult.rows[0];

      if (!challenge) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      if (
        new Date(challenge.expires_at).getTime() <=
        Date.now()
      ) {
        await query(
          `UPDATE password_reset_challenges
           SET consumed_at = NOW()
           WHERE id = $1`,
          [challenge.id]
        );

        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      if (
        challenge.attempts >=
        challenge.max_attempts
      ) {
        await query(
          `UPDATE password_reset_challenges
           SET consumed_at = NOW()
           WHERE id = $1`,
          [challenge.id]
        );

        return res.status(429).json({
          error:
            "Too many incorrect attempts. Please request a new OTP."
        });
      }

      const suppliedHash =
        hashOtp(data.otp);

      if (
        !safeOtpCompare(
          suppliedHash,
          challenge.otp_hash
        )
      ) {
        const attemptResult = await query(
          `UPDATE password_reset_challenges
           SET attempts = attempts + 1
           WHERE id = $1
           RETURNING attempts, max_attempts`,
          [challenge.id]
        );

        const attempts =
          attemptResult.rows[0]?.attempts ?? 0;

        if (
          attempts >= challenge.max_attempts
        ) {
          await query(
            `UPDATE password_reset_challenges
             SET consumed_at = NOW()
             WHERE id = $1`,
            [challenge.id]
          );
        }

        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      /*
       * Consume the OTP so it cannot be reused.
       */
      const consumedReset = await query(
        `UPDATE password_reset_challenges
         SET consumed_at = NOW()
         WHERE id = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
           AND attempts < max_attempts
           AND otp_hash = $2
         RETURNING id`,
        [challenge.id, suppliedHash]
      );

      if (!consumedReset.rows[0]) {
        return res.status(400).json({
          error: "Invalid or expired OTP"
        });
      }

      const passwordHash =
        await bcrypt.hash(
          data.newPassword,
          12
        );

      await query(
        `UPDATE users
         SET password_hash = $1
         WHERE id = $2`,
        [passwordHash, user.id]
      );

      /*
       * Invalidate all other active reset challenges
       * for this account.
       */
      await query(
        `UPDATE password_reset_challenges
         SET consumed_at = NOW()
         WHERE user_id = $1
           AND consumed_at IS NULL`,
        [user.id]
      );

      return res.json({
        message:
          "Password reset successfully. You can now log in with your new password."
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid password reset data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * LOGIN
 *
 * Phone verification is required.
 */
router.post(
  "/login",
  authRateLimit,
  async (req, res, next) => {
    try {
      const data =
        loginSchema.parse(req.body);

      const identifier =
        data.identifier.trim();

      const result = await query<any>(
        `SELECT
           id,
           name,
           phone,
           email,
           city,
           role,
           password_hash,
           phone_verified
         FROM users
         WHERE phone = $1
            OR (
              email IS NOT NULL
              AND LOWER(email) = LOWER($1)
            )
         LIMIT 1`,
        [identifier]
      );

      const user = result.rows[0];

      if (
        !user ||
        !(await bcrypt.compare(
          data.password,
          user.password_hash
        ))
      ) {
        return res.status(401).json({
          error:
            "Invalid email/phone or password"
        });
      }

      if (!user.phone_verified) {
        return res.status(403).json({
          error:
            "Phone number is not verified. Please verify your phone with OTP first.",
          phoneVerified: false
        });
      }

      delete user.password_hash;

      return res.json({
        user,
        token: signToken(
          user.id,
          user.role
        )
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid login data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

/*
 * CURRENT AUTHENTICATED USER
 */
router.get(
  "/me",
  requireAuth,
  async (
    req: AuthRequest,
    res,
    next
  ) => {
    try {
      const result = await query(
        `SELECT
           id,
           name,
           phone,
           email,
           city,
           role,
           phone_verified,
           created_at
         FROM users
         WHERE id = $1`,
        [req.user!.id]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      return res.json({
        user: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
