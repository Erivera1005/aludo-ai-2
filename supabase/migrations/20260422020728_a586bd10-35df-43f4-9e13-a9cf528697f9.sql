-- Add slug column for URL-based pet identification
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS slug TEXT;

-- Ensure slug uniqueness (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS pets_slug_unique_idx ON public.pets (LOWER(slug));
