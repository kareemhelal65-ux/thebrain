-- --------------------------------------------------------
-- MIGRATION: 004_users_refactor.sql
-- --------------------------------------------------------

-- 1. Safely add 'Manager' to user_role ENUM
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Manager';

-- 2. Alter the users table
ALTER TABLE public.users 
ADD COLUMN system_handle TEXT UNIQUE,
ADD COLUMN department TEXT;

-- We initially allow NULL for existing users, but new constraints apply
-- 3. Add Regex Constraint for the system_handle
ALTER TABLE public.users
ADD CONSTRAINT chk_system_handle_format 
CHECK (
    system_handle IS NULL OR 
    -- Executive Pattern: [COMPANY]_[POSITION] e.g., ACME_CEO
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+$' OR
    -- Standard Pattern: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] e.g., ACME_FINANCE_ANALYST_01
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[0-9]+$'
);

-- 4. Create the Trigger Function
CREATE OR REPLACE FUNCTION public.parse_system_handle()
RETURNS TRIGGER AS $$
DECLARE
    parts TEXT[];
    company_name TEXT;
    parsed_department TEXT;
    parsed_position TEXT;
    derived_role user_role;
    found_company_id UUID;
BEGIN
    IF NEW.system_handle IS NOT NULL THEN
        parts := string_to_array(NEW.system_handle, '_');
        company_name := parts[1];

        -- Lookup Company ID based on prefix
        SELECT id INTO found_company_id FROM public.companies WHERE name ILIKE company_name LIMIT 1;
        
        IF found_company_id IS NULL THEN
            RAISE EXCEPTION 'Company matching handle prefix "%" not found.', company_name;
        END IF;

        NEW.company_id := found_company_id;

        -- Executive format: [COMPANY]_[POSITION]
        IF array_length(parts, 1) = 2 THEN
            parsed_position := parts[2];
            parsed_department := 'EXECUTIVE';
            derived_role := 'Admin';
        
        -- Standard format: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER]
        ELSIF array_length(parts, 1) = 4 THEN
            parsed_department := parts[2];
            parsed_position := parts[3];
            
            IF parsed_position LIKE '%MANAGER%' OR parsed_position LIKE '%LEAD%' OR parsed_position LIKE '%HEAD%' OR parsed_position LIKE '%DIRECTOR%' OR parsed_position LIKE '%VP%' THEN
                derived_role := 'Manager';
            ELSE
                derived_role := 'Employee';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid system_handle structure. Must be 2 or 4 parts.';
        END IF;

        -- Assign the parsed values
        NEW.department := parsed_department;
        NEW.role := derived_role;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach Trigger to Users Table
DROP TRIGGER IF EXISTS trigger_parse_system_handle ON public.users;
CREATE TRIGGER trigger_parse_system_handle
BEFORE INSERT OR UPDATE OF system_handle ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.parse_system_handle();
