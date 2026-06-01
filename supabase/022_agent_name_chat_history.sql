-- Add agent_name column to chat_history for per-agent chat history filtering
ALTER TABLE public.chat_history ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Index for efficient per-agent history queries
CREATE INDEX IF NOT EXISTS idx_chat_history_agent_name ON public.chat_history(agent_name);
