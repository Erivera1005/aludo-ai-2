CREATE TABLE public.pets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  animal_type TEXT NOT NULL,
  breed TEXT,
  sex TEXT,
  age TEXT,
  owner_name TEXT,
  owner_contact TEXT,
  allergies TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert pets" ON public.pets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read pets" ON public.pets FOR SELECT USING (true);