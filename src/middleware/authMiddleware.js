const supabase = require('../models/supabaseClient');
const { generateUniqueJoinCode } = require('../utils/joinCode');

/**
 * Authentication Middleware
 * 
 * Verifies the Supabase JWT token from the Authorization header.
 * Populates req.user with user data from the token.
 * Skips validation for public endpoints.
 */
const PUBLIC_PATHS = ['/health', '/api/auth'];

const authMiddleware = async (req, res, next) => {
  // Skip auth for public paths
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  let token = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'No authorization token provided. Use "Bearer <token>" header or "?token=<token>" query parameter.' 
    });
  }

  try {
    // Verify the token with Supabase
    // Using getUser(token) is the safest way to verify the JWT is still valid
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid or expired token.',
        details: error ? error.message : null
      });
    }

    // Extract custom claims from app_metadata or user_metadata
    let companyId = user.app_metadata?.company_id || user.user_metadata?.company_id;
    let role = user.app_metadata?.role || user.user_metadata?.role || 'Admin';

    // ─── STEP 1: Check public.users for existing company_id BEFORE auto-provisioning ───
    // This is critical for tenant isolation: if a user has an existing record in public.users
    // with a valid company_id, we use that and sync it to the JWT metadata.
    // Without this check, a stale token or cleared metadata causes a WRONG new company to be
    // auto-provisioned, leading to cross-tenant data mixing.
    let dbUserRecord = null;
    try {
      const { data: dbUser, error: dbUserError } = await supabase
        .from('users')
        .select('id, company_id, role, department')
        .eq('id', user.id)
        .maybeSingle();
      
      if (!dbUserError && dbUser) {
        dbUserRecord = dbUser;
        
        // CASE A: JWT has NO company_id but public.users has one — recover from DB
        if (!companyId && dbUser.company_id) {
          companyId = dbUser.company_id;
          console.log(`[Auth] Recovered company_id from public.users for ${user.email}: ${companyId}`);
          
          // Sync JWT metadata to match the DB — prevents future mismatches
          await supabase.auth.admin.updateUserById(user.id, {
            app_metadata: { company_id: companyId, role: dbUser.role || 'Admin' }
          }).catch(err => console.warn('[Auth] Failed to sync JWT metadata:', err.message));
        }
        
        // CASE B: JWT has a company_id but it MISMATCHES public.users — THIS IS THE BUG
        // This is the most likely root cause of the tenant mixing issue:
        // The JWT metadata has a stale/wrong company_id (e.g., pointing to "Vite")
        // while public.users correctly points to "The Brain AIOS".
        if (companyId && dbUser.company_id && companyId !== dbUser.company_id) {
          console.error(
            `[Auth] company_id MISMATCH for ${user.email}! ` +
            `JWT metadata has ${companyId}, public.users has ${dbUser.company_id}. ` +
            `Correcting to DB value.`
          );
          companyId = dbUser.company_id;
          role = dbUser.role || role;
          // Sync JWT metadata to match the correct company
          await supabase.auth.admin.updateUserById(user.id, {
            app_metadata: { company_id: companyId, role }
          }).catch(err => console.warn('[Auth] Failed to sync JWT after mismatch:', err.message));
        }
        
        // Also recover role from DB if JWT metadata doesn't have it (or use JWT version)
        if (dbUser.role) {
          role = role || dbUser.role;
        }
      }
    } catch (lookupError) {
      console.warn('[Auth] Failed to lookup user in public.users:', lookupError.message);
    }

    // Auto-provision: If user STILL has no company (truly new user), create one
    if (!companyId) {
      try {
        const emailDomain = (user.email || '').split('@')[1] || 'default';
        const companyName = user.user_metadata?.full_name
          ? `${user.user_metadata.full_name}'s Company`
          : `${emailDomain} Company`;

        const joinCode = await generateUniqueJoinCode(supabase).catch(() => undefined);
        const { data: newCompany, error: companyError } = await supabase
          .from('companies')
          .insert([{ name: companyName, ...(joinCode ? { join_code: joinCode } : {}) }])
          .select()
          .single();

        if (companyError) {
          console.error('[Auth] Failed to create company:', companyError.message);
        } else {
          companyId = newCompany.id;
          // Store company_id in user metadata for next time
          await supabase.auth.admin.updateUserById(user.id, {
            app_metadata: { company_id: companyId, role: 'Admin' }
          });
          console.log(`[Auth] Auto-provisioned company "${companyName}" (${companyId}) for user ${user.email}`);
        }
      } catch (provisionError) {
        console.error('[Auth] Auto-provision error:', provisionError.message);
      }
    }

    // Auto-provision user record in the 'users' table if it does not exist
    let department = 'general';
    if (companyId) {
      try {
        if (dbUserRecord) {
          // User record already exists — use its department
          department = dbUserRecord.department || 'general';
        } else {
          // User record doesn't exist — create one
          const dept = user.app_metadata?.department || user.user_metadata?.department || 'general';
          const { error: insertError } = await supabase
            .from('users')
            .insert([{
              id: user.id,
              company_id: companyId,
              role: role,
              department: dept
            }]);

          if (insertError) {
            console.error('[Auth] Failed to auto-provision user profile in public.users:', insertError.message);
          } else {
            console.log(`[Auth] Auto-provisioned user profile in public.users for ${user.email} (Dept: ${dept})`);
            department = dept;
          }
        }
      } catch (userProvisionError) {
        console.error('[Auth] User auto-provision error:', userProvisionError.message);
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      company_id: companyId || null,
      role: role,
      department: department,
      token: token
    };

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Verification Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to verify authentication.' });
  }
};

module.exports = authMiddleware;
