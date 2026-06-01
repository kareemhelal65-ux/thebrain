/**
 * Middleware for Granular Role-Based Access Control (RBAC).
 * Expects req.user to be populated by a previous authentication middleware.
 * req.user should contain { id, company_id, role }
 */

const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    // Check if user object exists (set by auth middleware)
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
    }

    const { role } = req.user;

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};

/**
 * Appends the appropriate company/user filter for the database query based on role.
 * Admins can query company-wide, Employees can only query their own data.
 */
const auditLogScopeFilter = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    req.auditScope = { company_id: req.user.company_id };
    
    // If the user is just an Employee, restrict the logs to only their own user_id
    if (req.user.role === 'Employee') {
        req.auditScope.user_id = req.user.id;
    }

    next();
};

module.exports = {
  checkRole,
  auditLogScopeFilter
};
