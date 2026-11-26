-- Drop the three Pantry-only tables. Migration 0022 emptied them and kept them for the Console Worker
-- that ran while it applied. Every lane now runs a Console Worker that does not name them, and since
-- 0022 no view or trigger of another table names them. No table references them by a foreign key.
-- DROP TABLE also drops each table's own indexes and triggers.
DROP TABLE billing_jev_hours;
DROP TABLE billing_isolated_test_accounts;
DROP TABLE satyr_service_bindings;
