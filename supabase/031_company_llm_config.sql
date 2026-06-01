-- Migration: Per-company chat-model configuration.
-- Lets a company plug in a stronger model JUST for agent chat / agent work /
-- research / document generation. The rest of the OS stays on Groq.
-- The API key is encrypted at rest (AES-256-GCM via src/security/encryption.js).

CREATE TABLE IF NOT EXISTS public.company_llm_config (
  company_id        UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  provider          TEXT,            -- 'openai' | 'anthropic' | 'openrouter' | 'gemini' | 'agentrouter'
  model             TEXT,            -- e.g. 'gpt-4o', 'claude-sonnet-4', 'google/gemini-2.5-pro'
  base_url          TEXT,            -- only for 'agentrouter' (custom OpenAI-compatible endpoint)
  api_key_encrypted TEXT,
  api_key_iv        TEXT,
  api_key_tag       TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_llm_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_llm_config" ON public.company_llm_config;
CREATE POLICY "company_isolation_llm_config"
  ON public.company_llm_config
  FOR ALL
  USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.update_company_llm_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_company_llm_config_updated_at ON public.company_llm_config;
CREATE TRIGGER set_company_llm_config_updated_at
  BEFORE UPDATE ON public.company_llm_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_company_llm_config_updated_at();
