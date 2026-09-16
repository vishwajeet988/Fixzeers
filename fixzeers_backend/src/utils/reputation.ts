import { query } from "../db";

export async function recalculateReputation(professionalId: string) {
  const jobsResult = await query<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('completed','customer_confirmed')) AS verified_jobs,
       COUNT(*) FILTER (WHERE status <> 'cancelled') AS total_jobs,
       COUNT(*) FILTER (WHERE status IN ('completed','customer_confirmed')) AS completed_jobs
     FROM jobs WHERE professional_id=$1`,
    [professionalId]
  );

  const reviewResult = await query<any>(
    `SELECT COALESCE(AVG(rating),0) AS average_rating
     FROM reviews WHERE professional_id=$1`,
    [professionalId]
  );

  const profileResult = await query<any>(
    `SELECT years_experience FROM professional_profiles WHERE user_id=$1`,
    [professionalId]
  );

  const verifiedJobs = Number(jobsResult.rows[0]?.verified_jobs || 0);
  const totalJobs = Number(jobsResult.rows[0]?.total_jobs || 0);
  const completionRate = totalJobs ? (verifiedJobs / totalJobs) * 100 : 0;
  const averageRating = Number(reviewResult.rows[0]?.average_rating || 0);
  const years = Number(profileResult.rows[0]?.years_experience || 0);

  const jobComponent = Math.min(verifiedJobs / 100, 1) * 40;
  const ratingComponent = (averageRating / 5) * 20;
  const completionComponent = (completionRate / 100) * 20;
  const experienceComponent = Math.min(years / 10, 1) * 10;

  const verificationResult = await query<any>(
    `SELECT COUNT(*) FROM verification_records
     WHERE professional_id=$1 AND status='approved'`,
    [professionalId]
  );
  const verificationComponent =
    Math.min(Number(verificationResult.rows[0]?.count || 0), 1) * 10;

  const score = Math.max(0, Math.min(100, Math.round(
    jobComponent + ratingComponent + completionComponent +
    experienceComponent + verificationComponent
  )));

  await query(
    `INSERT INTO reputation_scores
      (professional_id,score,verified_jobs,average_rating,completion_rate)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (professional_id) DO UPDATE SET
       score=EXCLUDED.score,
       verified_jobs=EXCLUDED.verified_jobs,
       average_rating=EXCLUDED.average_rating,
       completion_rate=EXCLUDED.completion_rate,
       updated_at=NOW()`,
    [professionalId, score, verifiedJobs, averageRating, completionRate]
  );

  return { score, verifiedJobs, averageRating, completionRate };
}
