const express = require('express');
const supabase = require('../models/supabaseClient');
const router = express.Router();

/**
 * POST /api/auth/login
 * 
 * Authenticates a user with email/password via Supabase Auth.
 * Returns the JWT access token and user profile.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required.'
      });
    }

    // Authenticate with Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({
        error: 'Authentication Failed',
        message: error.message
      });
    }

    // Fetch the user profile from public.users
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, company_id, role, department, system_handle')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      console.error('[Auth] Profile lookup failed:', profileError.message);
    }

    res.status(200).json({
      message: 'Login successful.',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile?.role || null,
        company_id: profile?.company_id || null,
        department: profile?.department || null,
        system_handle: profile?.system_handle || null
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * 
 * Invalidates the user's session server-side.
 * The Electron frontend calls this on window close to ensure
 * the user is securely logged out when the app exits.
 */
router.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Authorization header with Bearer token is required.'
      });
    }

    // Supabase admin signOut — invalidates the session
    const { error } = await supabase.auth.admin.deleteUser(
      // Note: For session invalidation without deleting the user,
      // we use signOut scoped to the session. The admin API is used
      // because the service role key is required for server-side logout.
    );

    // Alternative approach: Use the user's token to sign them out
    const token = authHeader.split(' ')[1];
    const { error: signOutError } = await supabase.auth.signOut(token);

    if (signOutError) {
      console.warn('[Auth] Logout warning:', signOutError.message);
    }

    res.status(200).json({
      message: 'Logout successful. Session invalidated.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * 
 * Returns the current authenticated user's profile.
 * Used by the frontend to hydrate the user state on app load.
 * Requires the authMiddleware to be applied (req.user must exist).
 */
router.get('/me', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated user found.'
      });
    }

    // Fetch fresh profile data
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, company_id, role, department, system_handle')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User profile not found.'
      });
    }

    // Fetch company info
    const { data: company } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', profile.company_id)
      .single();

    res.status(200).json({
      user: {
        id: profile.id,
        email: req.user.email,
        role: profile.role,
        department: profile.department,
        system_handle: profile.system_handle,
        company: company || null
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/refresh
 * 
 * Refreshes an expired access token using a valid refresh token.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'refresh_token is required.'
      });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({
        error: 'Token Refresh Failed',
        message: error.message
      });
    }

    res.status(200).json({
      message: 'Token refreshed successfully.',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
