BEGIN;

-- Track whether the user has proved ownership of their phone number.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing accounts were created before OTP verification existed.
-- Keep them unverified so they must complete verification.
UPDATE users
SET phone_verified = FALSE
WHERE phone_verified IS NULL;

-- Store OTP challenges separately.
-- The OTP itself is NEVER stored in plaintext.
CREATE TABLE IF NOT EXISTS phone_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    otp_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    attempts INT NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    max_attempts INT NOT NULL DEFAULT 5
        CHECK (max_attempts > 0),

    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quickly find active OTP challenges for a user.
CREATE INDEX IF NOT EXISTS idx_phone_otp_user_created
ON phone_otp_challenges(user_id, created_at DESC);

-- Quickly find unexpired challenges.
CREATE INDEX IF NOT EXISTS idx_phone_otp_expiry
ON phone_otp_challenges(expires_at);

COMMIT;
