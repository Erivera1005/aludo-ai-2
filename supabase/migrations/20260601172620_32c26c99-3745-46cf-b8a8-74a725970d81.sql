GRANT SELECT, INSERT ON public.pets TO anon;
GRANT SELECT, INSERT ON public.pets TO authenticated;
GRANT ALL ON public.pets TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pets'
      AND policyname = 'Public can read pets by slug'
  ) THEN
    CREATE POLICY "Public can read pets by slug"
    ON public.pets
    FOR SELECT
    TO anon, authenticated
    USING (slug IS NOT NULL AND length(trim(slug)) > 0);
  END IF;
END $$;