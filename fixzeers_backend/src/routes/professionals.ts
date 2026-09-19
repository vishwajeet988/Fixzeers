import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { AuthRequest } from "../types";
import { recalculateReputation } from "../utils/reputation";
import {
  completeRouteTiming,
  startRouteTiming
} from "../observability";

const router = Router();

router.get("/", async (req, res, next) => {
  const routeStartedAt = startRouteTiming();

  try {
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();
    const area = String(req.query.area || "").trim();

    const result = await query(
      `SELECT
          u.id,
          u.name,
          p.bio,
          p.years_experience,
          p.service_area,
          p.availability,
          p.verification_status,
          p.skills,
          p.portfolio_urls,
          c.name AS category,
          c.slug AS category_slug,
          COALESCE(r.score, 0) AS score,
          COALESCE(r.verified_jobs, 0) AS verified_jobs,
          COALESCE(r.average_rating, 0) AS average_rating,
          COALESCE(r.completion_rate, 0) AS completion_rate
       FROM users u
       JOIN professional_profiles p
         ON p.user_id = u.id
       LEFT JOIN categories c
         ON c.id = p.category_id
       LEFT JOIN reputation_scores r
         ON r.professional_id = u.id
       WHERE u.role = 'professional'
         AND (
           $1 = ''
           OR u.name ILIKE '%' || $1 || '%'
           OR p.bio ILIKE '%' || $1 || '%'
           OR EXISTS (
             SELECT 1
             FROM unnest(p.skills) AS skill
             WHERE skill ILIKE '%' || $1 || '%'
           )
         )
         AND (
           $2 = ''
           OR c.slug = $2
           OR c.name ILIKE '%' || $2 || '%'
         )
         AND (
           $3 = ''
           OR p.service_area ILIKE '%' || $3 || '%'
         )
       ORDER BY
         COALESCE(r.score, 0) DESC,
         COALESCE(r.average_rating, 0) DESC
       LIMIT 50`,
      [q, category, area],
      "professionals.list"
    );

    res.json({
      professionals: result.rows
    });
  } catch (error) {
    next(error);
  } finally {
    completeRouteTiming("professionals.list", routeStartedAt);
  }
});

router.get(
  "/me/reputation",
  requireAuth,
  requireRole("professional"),
  async (req: AuthRequest, res, next) => {
    try {
      const reputation = await recalculateReputation(req.user!.id);
      res.json(reputation);
    } catch (error) {
      next(error);
    }
  }
);

const profileSchema = z.object({
  categoryId: z.number().int().positive().optional(),

  bio: z
    .string()
    .max(1000)
    .optional(),

  yearsExperience: z
    .number()
    .int()
    .min(0)
    .max(60)
    .optional(),

  serviceArea: z
    .string()
    .max(160)
    .optional(),

  availability: z
    .string()
    .max(80)
    .optional(),

  skills: z
    .array(z.string().trim().min(1).max(100))
    .max(30)
    .optional(),

  portfolioUrls: z
    .array(z.string().url())
    .max(20)
    .optional(),

  referencesText: z
    .array(z.string().trim().min(1).max(500))
    .max(10)
    .optional()
});

function validatePortfolioUrls(urls: string[]) {
  return urls.every((value) => {
    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" ||
        url.protocol === "http:"
      );
    } catch {
      return false;
    }
  });
}

router.put(
  "/profile/me",
  requireAuth,
  requireRole("professional"),
  async (req: AuthRequest, res, next) => {
    try {
      const data = profileSchema.parse(req.body);

      if (
        data.portfolioUrls &&
        !validatePortfolioUrls(data.portfolioUrls)
      ) {
        return res.status(400).json({
          error: "Portfolio URLs must use http or https."
        });
      }

      if (data.categoryId !== undefined) {
        const category = await query(
          `SELECT id
           FROM categories
           WHERE id = $1`,
          [data.categoryId]
        );

        if (!category.rows[0]) {
          return res.status(400).json({
            error: "Invalid service category"
          });
        }
      }

      const result = await query(
        `UPDATE professional_profiles
         SET
           category_id = COALESCE($2, category_id),
           bio = COALESCE($3, bio),
           years_experience = COALESCE($4, years_experience),
           service_area = COALESCE($5, service_area),
           availability = COALESCE($6, availability),
           skills = COALESCE($7, skills),
           portfolio_urls = COALESCE($8, portfolio_urls),
           references_text = COALESCE($9, references_text),
           updated_at = NOW()
         WHERE user_id = $1
         RETURNING *`,
        [
          req.user!.id,
          data.categoryId ?? null,
          data.bio ?? null,
          data.yearsExperience ?? null,
          data.serviceArea ?? null,
          data.availability ?? null,
          data.skills ?? null,
          data.portfolioUrls ?? null,
          data.referencesText ?? null
        ]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          error: "Professional profile not found"
        });
      }

      const reputation = await recalculateReputation(
        req.user!.id
      );

      res.json({
        profile: result.rows[0],
        reputation
      });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({
          error: "Invalid profile data",
          details: error.issues
        });
      }

      next(error);
    }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(400).json({
        error: "Invalid professional ID"
      });
    }

    const result = await query(
      `SELECT
          u.id,
          u.name,
          p.bio,
          p.years_experience,
          p.service_area,
          p.availability,
          p.verification_status,
          p.skills,
          p.portfolio_urls,
          c.name AS category,
          c.slug AS category_slug,
          COALESCE(r.score, 0) AS score,
          COALESCE(r.verified_jobs, 0) AS verified_jobs,
          COALESCE(r.average_rating, 0) AS average_rating,
          COALESCE(r.completion_rate, 0) AS completion_rate
       FROM users u
       JOIN professional_profiles p
         ON p.user_id = u.id
       LEFT JOIN categories c
         ON c.id = p.category_id
       LEFT JOIN reputation_scores r
         ON r.professional_id = u.id
       WHERE u.id = $1
         AND u.role = 'professional'`,
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        error: "Professional not found"
      });
    }

    const reviews = await query(
      `SELECT
          rating,
          comment,
          created_at
       FROM reviews
       WHERE professional_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    res.json({
      professional: result.rows[0],
      reviews: reviews.rows
    });
  } catch (error) {
    next(error);
  }
});

export default router;
