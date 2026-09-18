-- 002_role_integrity.sql
-- Run after schema.sql and 001_indexes_and_constraints.sql.

BEGIN;

-- Stop if existing data is inconsistent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jobs j JOIN users u ON u.id=j.customer_id WHERE u.role <> 'customer')
    THEN RAISE EXCEPTION 'jobs.customer_id contains a non-customer user'; END IF;
  IF EXISTS (SELECT 1 FROM jobs j JOIN users u ON u.id=j.professional_id WHERE u.role <> 'professional')
    THEN RAISE EXCEPTION 'jobs.professional_id contains a non-professional user'; END IF;
  IF EXISTS (SELECT 1 FROM reviews r JOIN users u ON u.id=r.customer_id WHERE u.role <> 'customer')
    THEN RAISE EXCEPTION 'reviews.customer_id contains a non-customer user'; END IF;
  IF EXISTS (SELECT 1 FROM reviews r JOIN users u ON u.id=r.professional_id WHERE u.role <> 'professional')
    THEN RAISE EXCEPTION 'reviews.professional_id contains a non-professional user'; END IF;
  IF EXISTS (SELECT 1 FROM reputation_scores r JOIN users u ON u.id=r.professional_id WHERE u.role <> 'professional')
    THEN RAISE EXCEPTION 'reputation_scores.professional_id contains a non-professional user'; END IF;
  IF EXISTS (SELECT 1 FROM verification_records v JOIN users u ON u.id=v.professional_id WHERE u.role <> 'professional')
    THEN RAISE EXCEPTION 'verification_records.professional_id contains a non-professional user'; END IF;
END $$;

-- Make (id, role) a referenced key.
ALTER TABLE users
  ADD CONSTRAINT users_id_role_unique UNIQUE (id, role);

-- Add role shadow columns used by composite foreign keys.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_role VARCHAR(20);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS professional_role VARCHAR(20);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS customer_role VARCHAR(20);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS professional_role VARCHAR(20);
ALTER TABLE reputation_scores ADD COLUMN IF NOT EXISTS professional_role VARCHAR(20);
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS professional_role VARCHAR(20);

-- Backfill existing valid rows.
UPDATE jobs SET customer_role='customer', professional_role='professional';
UPDATE reviews SET customer_role='customer', professional_role='professional';
UPDATE reputation_scores SET professional_role='professional';
UPDATE verification_records SET professional_role='professional';

-- Automatically set role columns from the referenced users.
CREATE OR REPLACE FUNCTION sync_relationship_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME='jobs' THEN
    SELECT role INTO NEW.customer_role FROM users WHERE id=NEW.customer_id;
    SELECT role INTO NEW.professional_role FROM users WHERE id=NEW.professional_id;
    IF NEW.customer_role <> 'customer' THEN RAISE EXCEPTION 'customer_id must reference a customer'; END IF;
    IF NEW.professional_role <> 'professional' THEN RAISE EXCEPTION 'professional_id must reference a professional'; END IF;
  ELSIF TG_TABLE_NAME='reviews' THEN
    SELECT role INTO NEW.customer_role FROM users WHERE id=NEW.customer_id;
    SELECT role INTO NEW.professional_role FROM users WHERE id=NEW.professional_id;
    IF NEW.customer_role <> 'customer' THEN RAISE EXCEPTION 'customer_id must reference a customer'; END IF;
    IF NEW.professional_role <> 'professional' THEN RAISE EXCEPTION 'professional_id must reference a professional'; END IF;
  ELSIF TG_TABLE_NAME='reputation_scores' THEN
    SELECT role INTO NEW.professional_role FROM users WHERE id=NEW.professional_id;
    IF NEW.professional_role <> 'professional' THEN RAISE EXCEPTION 'professional_id must reference a professional'; END IF;
  ELSIF TG_TABLE_NAME='verification_records' THEN
    SELECT role INTO NEW.professional_role FROM users WHERE id=NEW.professional_id;
    IF NEW.professional_role <> 'professional' THEN RAISE EXCEPTION 'professional_id must reference a professional'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jobs_sync_roles
BEFORE INSERT OR UPDATE OF customer_id, professional_id ON jobs
FOR EACH ROW EXECUTE FUNCTION sync_relationship_roles();

CREATE TRIGGER reviews_sync_roles
BEFORE INSERT OR UPDATE OF customer_id, professional_id ON reviews
FOR EACH ROW EXECUTE FUNCTION sync_relationship_roles();

CREATE TRIGGER reputation_sync_roles
BEFORE INSERT OR UPDATE OF professional_id ON reputation_scores
FOR EACH ROW EXECUTE FUNCTION sync_relationship_roles();

CREATE TRIGGER verification_sync_roles
BEFORE INSERT OR UPDATE OF professional_id ON verification_records
FOR EACH ROW EXECUTE FUNCTION sync_relationship_roles();

-- Replace ID-only FKs with role-aware FKs.
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_customer_id_fkey,
  DROP CONSTRAINT IF EXISTS jobs_professional_id_fkey,
  ADD CONSTRAINT jobs_customer_role_fkey
    FOREIGN KEY (customer_id, customer_role) REFERENCES users(id, role),
  ADD CONSTRAINT jobs_professional_role_fkey
    FOREIGN KEY (professional_id, professional_role) REFERENCES users(id, role);

ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS reviews_customer_id_fkey,
  DROP CONSTRAINT IF EXISTS reviews_professional_id_fkey,
  ADD CONSTRAINT reviews_customer_role_fkey
    FOREIGN KEY (customer_id, customer_role) REFERENCES users(id, role),
  ADD CONSTRAINT reviews_professional_role_fkey
    FOREIGN KEY (professional_id, professional_role) REFERENCES users(id, role);

ALTER TABLE reputation_scores
  DROP CONSTRAINT IF EXISTS reputation_scores_professional_id_fkey,
  ADD CONSTRAINT reputation_scores_professional_role_fkey
    FOREIGN KEY (professional_id, professional_role) REFERENCES users(id, role);

ALTER TABLE verification_records
  DROP CONSTRAINT IF EXISTS verification_records_professional_id_fkey,
  ADD CONSTRAINT verification_records_professional_role_fkey
    FOREIGN KEY (professional_id, professional_role) REFERENCES users(id, role);

COMMIT;
