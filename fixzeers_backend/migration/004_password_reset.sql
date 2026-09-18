BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_challenges (
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

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
ON password_reset_challenges(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_expiry
ON password_reset_challenges(expires_at);

COMMIT;