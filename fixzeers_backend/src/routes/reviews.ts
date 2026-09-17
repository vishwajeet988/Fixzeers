import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { AuthRequest } from "../types";
import { recalculateReputation } from "../utils/reputation";

const router = Router();

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(2000)
    .optional()
});

router.post("/:jobId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const data = reviewSchema.parse(req.body);

    const result = await query(
      `SELECT *
       FROM jobs
       WHERE id = $1`,
      [req.params.jobId]
    );

    const job = result.rows[0];

    if (!job) {
      return res.status(404).json({
        error: "Job not found"
      });
    }

    if (job.customer_id !== req.user!.id) {
      return res.status(403).json({
        error: "Only the customer can review"
      });
    }

    if (job.status !== "customer_confirmed") {
      return res.status(400).json({
        error: "Job must be customer-confirmed before reviewing"
      });
    }

    const review = await query(
      `INSERT INTO reviews
        (
          job_id,
          customer_id,
          professional_id,
          rating,
          comment
        )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        job.id,
        job.customer_id,
        job.professional_id,
        data.rating,
        data.comment && data.comment.length > 0
          ? data.comment
          : null
      ]
    );

    const reputation = await recalculateReputation(
      job.professional_id
    );

    return res.status(201).json({
      review: review.rows[0],
      reputation
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({
        error: "This job has already been reviewed"
      });
    }

    if (error?.name === "ZodError") {
      return res.status(400).json({
        error: "Invalid review data"
      });
    }

    next(error);
  }
});

router.get(
  "/professional/:professionalId",
  async (req, res, next) => {
    try {
      const result = await query(
        `SELECT
           r.rating,
           r.comment,
           r.created_at,
           u.name AS customer_name
         FROM reviews r
         JOIN users u
           ON u.id = r.customer_id
         WHERE r.professional_id = $1
         ORDER BY r.created_at DESC`,
        [req.params.professionalId]
      );

      return res.json({
        reviews: result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;