-- Fixzeers database hardening migration
-- Safe to run against an existing database.

BEGIN;

-- Job lookup indexes
CREATE INDEX IF NOT EXISTS idx_jobs_customer_id
  ON jobs(customer_id);

CREATE INDEX IF NOT EXISTS idx_jobs_professional_id
  ON jobs(professional_id);

CREATE INDEX IF NOT EXISTS idx_jobs_status
  ON jobs(status);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at
  ON jobs(created_at DESC);

-- Job event lookup
CREATE INDEX IF NOT EXISTS idx_job_events_job_id
  ON job_events(job_id);

CREATE INDEX IF NOT EXISTS idx_job_events_actor_id
  ON job_events(actor_id);

-- Review lookup
CREATE INDEX IF NOT EXISTS idx_reviews_professional_id
  ON reviews(professional_id);

CREATE INDEX IF NOT EXISTS idx_reviews_customer_id
  ON reviews(customer_id);

CREATE INDEX IF NOT EXISTS idx_reviews_created_at
  ON reviews(created_at DESC);

-- Verification lookup
CREATE INDEX IF NOT EXISTS idx_verification_records_professional_id
  ON verification_records(professional_id);

CREATE INDEX IF NOT EXISTS idx_verification_records_status
  ON verification_records(status);

-- Complaint lookup
CREATE INDEX IF NOT EXISTS idx_complaints_job_id
  ON complaints(job_id);

CREATE INDEX IF NOT EXISTS idx_complaints_professional_id
  ON complaints(professional_id);

CREATE INDEX IF NOT EXISTS idx_complaints_customer_id
  ON complaints(customer_id);

CREATE INDEX IF NOT EXISTS idx_complaints_status
  ON complaints(status);

COMMIT;