-- =============================================================
-- StoneSight AI — Supabase Database Setup
-- =============================================================

-- 1. User Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'dev')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Generations table — stores ALL AI interactions
CREATE TABLE IF NOT EXISTS public.generations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
  generation_type TEXT NOT NULL CHECK (generation_type IN ('image', 'video')),

  -- Input data
  input_prompt TEXT,
  input_image_url TEXT,
  input_parameters JSONB,

  -- Output data
  output_url TEXT NOT NULL,
  output_metadata JSONB,

  -- AI Brain metadata
  processing_time_ms INTEGER,
  model_used TEXT,
  tags TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AI Memory / Brain aggregation
CREATE TABLE IF NOT EXISTS public.ai_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_type TEXT NOT NULL,
  content JSONB NOT NULL,
  source_generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  relevance_score FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- Indexes
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_type ON public.generations(generation_type);
CREATE INDEX IF NOT EXISTS idx_generations_created ON public.generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memory_type ON public.ai_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_ai_memory_relevance ON public.ai_memory(relevance_score DESC);

-- =============================================================
-- Auto-update updated_at trigger
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_user_profiles ON public.user_profiles;
CREATE TRIGGER set_updated_at_user_profiles
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_ai_memory ON public.ai_memory;
CREATE TRIGGER set_updated_at_ai_memory
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================
-- Row Level Security (RLS)
-- =============================================================

-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

-- ---- user_profiles ----
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admin/dev can view all profiles" ON public.user_profiles;
CREATE POLICY "Admin/dev can view all profiles" ON public.user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
    )
  );

-- ---- generations ----
DROP POLICY IF EXISTS "Users can view own generations" ON public.generations;
CREATE POLICY "Users can view own generations" ON public.generations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own generations" ON public.generations;
CREATE POLICY "Users can insert own generations" ON public.generations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own generations" ON public.generations;
CREATE POLICY "Users can delete own generations" ON public.generations
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin/dev can view all generations" ON public.generations;
CREATE POLICY "Admin/dev can view all generations" ON public.generations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
    )
  );

DROP POLICY IF EXISTS "Admin/dev can delete any generation" ON public.generations;
CREATE POLICY "Admin/dev can delete any generation" ON public.generations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
    )
  );

-- ---- ai_memory ----
DROP POLICY IF EXISTS "Anyone authenticated can insert memory" ON public.ai_memory;
CREATE POLICY "Anyone authenticated can insert memory" ON public.ai_memory
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin/dev can view all memories" ON public.ai_memory;
CREATE POLICY "Admin/dev can view all memories" ON public.ai_memory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
    )
  );

DROP POLICY IF EXISTS "Anyone authenticated can view memories" ON public.ai_memory;
CREATE POLICY "Anyone authenticated can view memories" ON public.ai_memory
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- =============================================================
-- Storage Buckets
-- =============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('user-inputs', 'user-inputs', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('user-outputs', 'user-outputs', true) ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for user-inputs
DROP POLICY IF EXISTS "Users can upload own inputs" ON storage.objects;
CREATE POLICY "Users can upload own inputs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-inputs' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can view own inputs" ON storage.objects;
CREATE POLICY "Users can view own inputs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-inputs' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
      )
    )
  );

-- Storage RLS policies for user-outputs
DROP POLICY IF EXISTS "Users can upload own outputs" ON storage.objects;
CREATE POLICY "Users can upload own outputs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-outputs' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can view own outputs" ON storage.objects;
CREATE POLICY "Users can view own outputs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-outputs' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin', 'dev')
      )
    )
  );

-- Done!
