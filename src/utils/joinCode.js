/**
 * Company join-code helpers. Codes are short, human-friendly, and unambiguous
 * (no 0/O/1/I/L) so they're easy to share verbally or paste.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function generateJoinCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Generate a join code guaranteed not to collide with an existing company.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function generateUniqueJoinCode(supabase) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateJoinCode();
    const { data, error } = await supabase
      .from('companies')
      .select('id')
      .eq('join_code', code)
      .maybeSingle();
    if (!error && !data) return code;
  }
  // Extremely unlikely; widen with a timestamp suffix as a last resort.
  return generateJoinCode() + Date.now().toString(36).slice(-2).toUpperCase();
}

module.exports = { generateJoinCode, generateUniqueJoinCode };
