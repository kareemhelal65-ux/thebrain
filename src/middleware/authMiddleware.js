const supabase = require('../models/supabaseClient');

/**
 * Authentication Middleware
 * 
 * Verifies the Supabase JWT token from the Authorization header.
 * Populates req.user with user data from the token.
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'No authorization token provided. Use "Bearer <token>".' 
    });
  }

  const token = authHeader.split(' ')[1];

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
    // RLS in Supabase usually relies on app_metadata
    const companyId = user.app_metadata?.company_id || user.user_metadata?.company_id;
    const role = user.app_metadata?.role || user.user_metadata?.role || 'Employee';

    req.user = {
      id: user.id,
      email: user.email,
      company_id: companyId,
      role: role,
      token: token // Keep the token if we need to initialize a user-specific Supabase client
    };

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Verification Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to verify authentication.' });
  }
};

module.exports = authMiddleware;
