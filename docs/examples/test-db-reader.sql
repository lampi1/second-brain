-- SQL Server (not Azure SQL Database without DBA adaptation): reviewed template for ONE explicitly approved TEST database and an already-created dedicated SQL login.
-- Used only by the user/DBA outside the app. Never run unchanged; no credentials, production names or auto-execution.
-- Replace all REPLACE_* identifiers/literals together after verifying the exact target. Repeat separately per DB.
-- Create the login securely yourself first, with no server roles, ownership, impersonation or other database mappings.
USE [REPLACE_EXACT_TEST_DATABASE];
GO
IF DB_NAME() COLLATE Latin1_General_100_BIN2 <> N'REPLACE_EXACT_TEST_DATABASE' COLLATE Latin1_General_100_BIN2
   OR DB_NAME() = N'REPLACE_EXACT_TEST_DATABASE'
    THROW 51000, 'Replace and independently verify the exact test database before executing this template.', 1;
-- Remove the placeholder equality clause above ONLY in the reviewed local copy after replacing the placeholder.
IF EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND (is_trustworthy_on = 1 OR is_db_chaining_on = 1))
    THROW 51000, 'TRUSTWORTHY and database ownership chaining must be disabled before provisioning.', 1;
IF EXISTS (SELECT 1 FROM sys.configurations WHERE name = N'cross db ownership chaining' AND value_in_use <> 0)
    THROW 51000, 'Server-wide cross-database ownership chaining must be disabled.', 1;
IF SUSER_ID(N'REPLACE_DEDICATED_LOGIN') IS NULL
    THROW 51000, 'The DBA must first create a dedicated restricted SQL login securely.', 1;
IF OBJECT_ID(N'REPLACE_SCHEMA.REPLACE_LOCAL_TABLE', N'U') IS NULL
    THROW 51000, 'Only an individually reviewed local base table can be granted by this template.', 1;
IF EXISTS (SELECT 1 FROM sys.external_tables WHERE object_id = OBJECT_ID(N'REPLACE_SCHEMA.REPLACE_LOCAL_TABLE'))
    THROW 51000, 'External tables are not permitted.', 1;

BEGIN TRANSACTION;
BEGIN TRY
    CREATE USER [REPLACE_DATABASE_READER] FOR LOGIN [REPLACE_DEDICATED_LOGIN];
    GRANT CONNECT TO [REPLACE_DATABASE_READER];
    DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER, TAKE OWNERSHIP, IMPERSONATE ANY USER TO [REPLACE_DATABASE_READER];
    DENY CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE SYNONYM, CREATE ASSEMBLY TO [REPLACE_DATABASE_READER];
    GRANT SELECT ON OBJECT::[REPLACE_SCHEMA].[REPLACE_LOCAL_TABLE] TO [REPLACE_DATABASE_READER];
    -- Keep guest disabled in this TEST database. Audit other databases' guest/public access separately as DBA.
    REVOKE CONNECT FROM guest;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
-- No db_datareader/db_owner, broad schema grants, EXEC grants, linked-server mappings or changes to other databases.
-- Audit effective login permissions and all computed columns/dependencies before adding this target to the host config.
