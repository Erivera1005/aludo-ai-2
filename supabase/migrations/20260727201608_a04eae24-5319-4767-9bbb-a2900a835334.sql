CREATE OR REPLACE FUNCTION public.consume_pet_usage(_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec public.pets%ROWTYPE;
  today DATE := (now() AT TIME ZONE 'UTC')::date;
  daily_limit CONSTANT INTEGER := 5;
  lifetime_limit CONSTANT INTEGER := 100;
  current_daily INTEGER;
BEGIN
  SELECT * INTO rec FROM public.pets WHERE LOWER(slug) = LOWER(_slug) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile');
  END IF;

  IF rec.total_usage_count >= lifetime_limit OR rec.is_blocked THEN
    UPDATE public.pets SET is_blocked = TRUE WHERE id = rec.id;
    RETURN jsonb_build_object('status', 'expired', 'lifetime_limit', lifetime_limit);
  END IF;

  IF rec.last_used_date IS NULL OR rec.last_used_date < today THEN
    current_daily := 0;
  ELSE
    current_daily := rec.daily_usage_count;
  END IF;

  IF current_daily >= daily_limit THEN
    RETURN jsonb_build_object(
      'status', 'daily_blocked',
      'daily_limit', daily_limit,
      'used_today', current_daily
    );
  END IF;

  UPDATE public.pets
  SET first_use_at = COALESCE(first_use_at, now()),
      last_used_date = today,
      daily_usage_count = current_daily + 1,
      total_usage_count = rec.total_usage_count + 1,
      is_blocked = CASE WHEN rec.total_usage_count + 1 >= lifetime_limit THEN TRUE ELSE FALSE END
  WHERE id = rec.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'daily_limit', daily_limit,
    'used_today', current_daily + 1,
    'remaining_today', daily_limit - (current_daily + 1),
    'total_used', rec.total_usage_count + 1,
    'lifetime_limit', lifetime_limit
  );
END;
$function$;