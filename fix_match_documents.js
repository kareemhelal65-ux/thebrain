const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function fixMatchDocuments() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Updating match_documents function...');

    await client.query(`
      DROP FUNCTION IF EXISTS match_documents(vector(768), FLOAT, INT, UUID);
      DROP FUNCTION IF EXISTS match_documents(vector, FLOAT, INT, UUID);

      CREATE OR REPLACE FUNCTION match_documents(
          query_embedding vector(384),
          match_threshold FLOAT DEFAULT 0.2,
          match_count INT DEFAULT 8,
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

    console.log('✅ match_documents updated to 384 dimensions.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

fixMatchDocuments();
