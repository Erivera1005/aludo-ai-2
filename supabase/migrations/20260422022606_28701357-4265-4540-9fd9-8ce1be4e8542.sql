-- Add usage tracking columns to pets
ALTER TABLE public.pets
  ADD COLUMN IF NOT EXISTS first_use_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_used_date DATE,
  ADD COLUMN IF NOT EXISTS daily_usage_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_day_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Atomic usage consumption function. Returns a JSON with status & remaining info.
CREATE OR REPLACE FUNCTION public.consume_pet_usage(_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.pets%ROWTYPE;
  today DATE := (now() AT TIME ZONE 'UTC')::date;
  daily_limit INTEGER;
  new_day_index INTEGER;
  expires_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO rec FROM public.pets WHERE LOWER(slug) = LOWER(_slug) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile');
  END IF;

  -- Lifetime expiration: 4 months from first use
  IF rec.first_use_at IS NOT NULL THEN
    expires_at := rec.first_use_at + INTERVAL '4 months';
    IF now() > expires_at THEN
      RETURN jsonb_build_object('status', 'expired', 'expires_at', expires_at);
    END IF;
  END IF;

  -- Already blocked (used all 5 days)
  IF rec.is_blocked THEN
    RETURN jsonb_build_object('status', 'monthly_blocked');
  END IF;

  -- Determine current day index
  IF rec.first_use_at IS NULL THEN
    new_day_index := 1;
  ELSIF rec.last_used_date IS NULL OR rec.last_used_date < today THEN
    new_day_index := COALESCE(rec.usage_day_index, 0) + 1;
  ELSE
    new_day_index := rec.usage_day_index;
  END IF;

  -- If new day pushes beyond 5, block
  IF new_day_index > 5 THEN
    UPDATE public.pets SET is_blocked = TRUE WHERE id = rec.id;
    RETURN jsonb_build_object('status', 'monthly_blocked');
  END IF;

  -- Daily limit per day index
  daily_limit := CASE new_day_index
    WHEN 1 THEN 10
    WHEN 2 THEN 7
    ELSE 5
  END;

  -- Reset counter if it's a new day
  IF rec.last_used_date IS NULL OR rec.last_used_date < today THEN
    rec.daily_usage_count := 0;
  END IF;

  -- Check daily cap
  IF rec.daily_usage_count >= daily_limit THEN
    RETURN jsonb_build_object(
      'status', 'daily_blocked',
      'day_index', new_day_index,
      'daily_limit', daily_limit,
      'used_today', rec.daily_usage_count
    );
  END IF;

  -- Consume one usage
  UPDATE public.pets
  SET
    first_use_at = COALESCE(first_use_at, now()),
    last_used_date = today,
    usage_day_index = new_day_index,
    daily_usage_count = rec.daily_usage_count + 1,
    is_blocked = CASE WHEN new_day_index = 5 AND rec.daily_usage_count + 1 >= daily_limit THEN
                   -- still allow this last call; block kicks in next attempt
                   FALSE
                 ELSE FALSE END
  WHERE id = rec.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'day_index', new_day_index,
    'daily_limit', daily_limit,
    'used_today', rec.daily_usage_count + 1,
    'remaining_today', daily_limit - (rec.daily_usage_count + 1)
  );
END;
$$;

-- Allow anonymous calls (no auth in this app)
GRANT EXECUTE ON FUNCTION public.consume_pet_usage(TEXT) TO anon, authenticated;