import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { AuthRequest } from "../types";
import { recalculateReputation } from "../utils/reputation";

const router = Router();

const createSchema = z.object({
  professionalId: z.string().uuid(),
  categoryId: z.number().int().positive().optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(3000).optional(),
  address: z.string().trim().max(500).optional(),
  scheduledAt: z.string().datetime().optional()
});

const statusSchema = z.object({
  status: z.enum([
    "accepted",
    "scheduled",
    "arrived",
    "in_progress",
    "completed",
    "customer_confirmed",
    "cancelled",
    "disputed"
  ])
});

const transitions: Record<string, string[]> = {
  requested: ["accepted", "cancelled"],
  accepted: ["scheduled", "arrived", "cancelled"],
  scheduled: ["arrived", "cancelled"],
  arrived: ["in_progress", "disputed"],
  in_progress: ["completed", "disputed"],
  completed: ["customer_confirmed", "disputed"],
  customer_confirmed: [],
  cancelled: [],
  disputed: []
};

router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      if (req.user!.role !== "customer") {
        return res.status(403).json({
          error: "Only customers can create jobs"
        });
      }

      const data = createSchema.parse(req.body);

      // Verify that the selected user is actually a professional
      // and retrieve their registered service category.
      const professional = await query(
        `SELECT
           pp.user_id,
           pp.category_id,
           c.name AS category_name
         FROM professional_profiles pp
         JOIN users u
           ON u.id = pp.user_id
         LEFT JOIN categories c
           ON c.id = pp.category_id
         WHERE pp.user_id = $1
           AND u.role = 'professional'`,
        [data.professionalId]
      );

      const professionalRow = professional.rows[0];

      if (!professionalRow) {
        return res.status(404).json({
          error: "Professional not found"
        });
      }

      // A professional must have a service category before accepting
      // category-specific jobs.
      if (!professionalRow.category_id) {
        return res.status(400).json({
          error:
            "This professional has not selected a service category yet"
        });
      }

      // If the customer supplies a category, it MUST match the
      // professional's registered category.
      if (
        data.categoryId !== undefined &&
        data.categoryId !== professionalRow.category_id
      ) {
        return res.status(400).json({
          error:
            "Selected category does not match this professional's service category",
          professionalCategoryId: professionalRow.category_id,
          professionalCategory: professionalRow.category_name
        });
      }

      // If category wasn't supplied, derive it from the professional.
      const categoryId =
        data.categoryId ?? professionalRow.category_id;

      // Confirm that the category itself exists.
      const category = await query(
        `SELECT id, name
         FROM categories
         WHERE id = $1`,
        [categoryId]
      );

      if (!category.rows[0]) {
        return res.status(400).json({
          error: "Invalid service category"
        });
      }

      const result = await query(
        `INSERT INTO jobs
          (
            customer_id,
            professional_id,
            category_id,
            title,
            description,
            address,
            scheduled_at
          )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.user!.id,
          data.professionalId,
          categoryId,
          data.title,
          data.description && data.description.length > 0
            ? data.description
            : null,
          data.address && data.address.length > 0
            ? data.address
            : null,
          data.scheduledAt ?? null
        ]
      );

      await query(
        `INSERT INTO job_events
          (job_id, status, actor_id)
         VALUES ($1, 'requested', $2)`,
        [result.rows[0].id, req.user!.id]
      );

      return res.status(201).json({
        job: result.rows[0]
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid job data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const result = await query(
        `SELECT
           j.*,
           cu.name AS customer_name,
           pu.name AS professional_name,
           c.name AS category
         FROM jobs j
         JOIN users cu
           ON cu.id = j.customer_id
         JOIN users pu
           ON pu.id = j.professional_id
         LEFT JOIN categories c
           ON c.id = j.category_id
         WHERE j.customer_id = $1
            OR j.professional_id = $1
         ORDER BY j.created_at DESC`,
        [req.user!.id]
      );

      return res.json({
        jobs: result.rows
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const result = await query(
        `SELECT
           j.*,
           cu.name AS customer_name,
           pu.name AS professional_name,
           c.name AS category
         FROM jobs j
         JOIN users cu
           ON cu.id = j.customer_id
         JOIN users pu
           ON pu.id = j.professional_id
         LEFT JOIN categories c
           ON c.id = j.category_id
         WHERE j.id = $1`,
        [req.params.id]
      );

      const job = result.rows[0];

      if (!job) {
        return res.status(404).json({
          error: "Job not found"
        });
      }

      if (
        job.customer_id !== req.user!.id &&
        job.professional_id !== req.user!.id &&
        req.user!.role !== "admin"
      ) {
        return res.status(403).json({
          error: "Not authorized for this job"
        });
      }

      return res.json({
        job
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:id/status",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { status } = statusSchema.parse(req.body);

      const current = await query(
        `SELECT *
         FROM jobs
         WHERE id = $1`,
        [req.params.id]
      );

      const job = current.rows[0];

      if (!job) {
        return res.status(404).json({
          error: "Job not found"
        });
      }

      const isCustomer =
        job.customer_id === req.user!.id;

      const isProfessional =
        job.professional_id === req.user!.id;

      const isAdmin =
        req.user!.role === "admin";

      if (!isCustomer && !isProfessional && !isAdmin) {
        return res.status(403).json({
          error: "Not authorized"
        });
      }

      if (!transitions[job.status]?.includes(status)) {
        return res.status(400).json({
          error: `Cannot move job from ${job.status} to ${status}`
        });
      }

      if (status === "accepted" && !isProfessional) {
        return res.status(403).json({
          error: "Only the professional can accept"
        });
      }

      if (status === "customer_confirmed" && !isCustomer) {
        return res.status(403).json({
          error: "Only the customer can confirm"
        });
      }

      if (
        status === "cancelled" &&
        !isCustomer &&
        !isProfessional &&
        !isAdmin
      ) {
        return res.status(403).json({
          error:
            "Only the customer, professional, or admin can cancel"
        });
      }

      if (
        status === "disputed" &&
        !isCustomer &&
        !isProfessional &&
        !isAdmin
      ) {
        return res.status(403).json({
          error:
            "Only the customer, professional, or admin can dispute"
        });
      }

      // Atomic status transition prevents two concurrent requests
      // from changing the same job based on stale status.
      const result = await query(
        `UPDATE jobs
         SET status = $1,
             updated_at = NOW()
         WHERE id = $2
           AND status = $3
         RETURNING *`,
        [status, req.params.id, job.status]
      );

      if (!result.rows[0]) {
        return res.status(409).json({
          error:
            "Job status changed before this update could be completed. Please refresh and try again."
        });
      }

      await query(
        `INSERT INTO job_events
          (job_id, status, actor_id)
         VALUES ($1, $2, $3)`,
        [
          req.params.id,
          status,
          req.user!.id
        ]
      );

      let reputation = null;

      if (status === "customer_confirmed") {
        reputation = await recalculateReputation(
          job.professional_id
        );
      }

      return res.json({
        job: result.rows[0],
        ...(reputation ? { reputation } : {})
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid status"
        });
      }

      next(error);
    }
  }
);

export default router;