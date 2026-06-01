-- --------------------------------------------------------
-- MIGRATION: 006_fix_executive_handle.sql
-- --------------------------------------------------------
-- Fixes the executive system_handle format from 2-part
-- (COMPANY_POSITION) to 3-part (COMPANY_POSITION_NUMBER).
-- Standard employee format remains 4-part unchanged.
-- --------------------------------------------------------

-- 1. Drop the old constraint
ALTER TABLE public.users
DROP CONSTRAINT IF EXISTS chk_system_handle_format;

-- 2. Re-create with corrected patterns
ALTER TABLE public.users
ADD CONSTRAINT chk_system_handle_format
CHECK (
    system_handle IS NULL OR
    -- Executive Pattern: [COMPANY]_[POSITION]_[NUMBER] e.g., ACME_CEO_01
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[0-9]+$' OR
    -- Standard Pattern: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] e.g., ACME_FINANCE_ANALYST_01
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[0-9]+$'
);

-- 3. Update the trigger function to handle 3-part executive handles
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

        -- Executive format: [COMPANY]_[POSITION]_[NUMBER] (3 parts)
        IF array_length(parts, 1) = 3 THEN
            parsed_position := parts[2];
            parsed_department := 'EXECUTIVE';
            derived_role := 'Admin';
        
        -- Standard format: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] (4 parts)
        ELSIF array_length(parts, 1) = 4 THEN
            parsed_department := parts[2];
            parsed_position := parts[3];
            
            IF parsed_position LIKE '%MANAGER%' OR parsed_position LIKE '%LEAD%' OR parsed_position LIKE '%HEAD%' OR parsed_position LIKE '%DIRECTOR%' OR parsed_position LIKE '%VP%' THEN
                derived_role := 'Manager';
            ELSE
                derived_role := 'Employee';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid system_handle structure. Must be 3 parts (executive) or 4 parts (standard).';
        END IF;

        -- Assign the parsed values
        NEW.department := parsed_department;
        NEW.role := derived_role;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_parse_system_handle ON public.users;
CREATE TRIGGER trigger_parse_system_handle
BEFORE INSERT OR UPDATE OF system_handle ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.parse_system_handle();
