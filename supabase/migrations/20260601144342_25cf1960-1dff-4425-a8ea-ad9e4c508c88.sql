
-- 1) Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can read pets" ON public.pets;
DROP POLICY IF EXISTS "Anyone can insert pets" ON public.pets;

-- 2) Re-add INSERT policy with a real check (not always-true)
CREATE POLICY "Public can create pets with slug"
ON public.pets
FOR INSERT
TO anon, authenticated
WITH CHECK (slug IS NOT NULL AND length(trim(slug)) > 0);

-- 3) No SELECT policy on public.pets => anon/authenticated cannot read sensitive owner fields directly.
--    Revoke direct SELECT grants to be explicit.
REVOKE SELECT ON public.pets FROM anon, authenticated;
GRANT INSERT ON public.pets TO anon, authenticated;
GRANT ALL ON public.pets TO service_role;

-- 4) Safe public view excluding owner_name and owner_contact
DROP VIEW IF EXISTS public.pets_public;
CREATE VIEW public.pets_public
WITH (security_invoker = on) AS
SELECT
  id,
  name,
  animal_type,
  breed,
  sex,
  age,
  allergies,
  slug,
  created_at,
  first_use_at,
  last_used_date,
  daily_usage_count,
  usage_day_index,
  total_usage_count,
  is_blocked
FROM public.pets;

GRANT SELECT ON public.pets_public TO anon, authenticated;

-- 5) Lock down SECURITY DEFINER function: only service_role may execute
REVOKE EXECUTE ON FUNCTION public.consume_pet_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_pet_usage(text) TO service_role;
