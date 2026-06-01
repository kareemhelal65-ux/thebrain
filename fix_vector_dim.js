const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function fixVectorDimension() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Fixing vector dimension...');
    
    // Drop the old index and column, recreate with 384 dims
    await client.query(`
      DROP INDEX IF EXISTS idx_document_chunks_embedding;
      ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
      ALTER TABLE public.document_chunks ADD COLUMN embedding vector(384);
      CREATE INDEX idx_document_chunks_embedding 
        ON public.document_chunks 
        USING ivfflat (embedding vector_cosine_ops) 
        WITH (lists = 100);
    `);
    
    // Also update the match_documents function
    await client.query(`
      CREATE OR REPLACE FUNCTION match_documents(
          query_embedding vector(384),
          match_threshold FLOAT DEFAULT 0.5,
          match_count INT DEFAULT 5,
          filter_tenant_id UUID DEFAULT NULL
      )
      RETURNS TABLE (
          id UUID,
          content TEXT,
          source_type TEXT,
          source_id TEXT,
          source_title TEXT,
          metadata JSONB,
          similarity FLOAT
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
          RETURN QUERY
          SELECT
              dc.id,
              dc.content,
              dc.source_type,
              dc.source_id,
              dc.source_title,
              dc.metadata,
              1 - (dc.embedding <=> query_embedding) AS similarity
          FROM public.document_chunks dc
          WHERE
              (filter_tenant_id IS NULL OR dc.tenant_id = filter_tenant_id)
              AND 1 - (dc.embedding <=> query_embedding) > match_threshold
          ORDER BY dc.embedding <=> query_embedding
          LIMIT match_count;
      END;
      $$;
    `);
    
    console.log('✅ Vector dimension updated to 384 (all-MiniLM-L6-v2)');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

fixVectorDimension();
