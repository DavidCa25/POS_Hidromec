IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (
    id INT IDENTITY(1,1) PRIMARY KEY,
    filename NVARCHAR(255) NOT NULL UNIQUE,
    applied_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
  );
END
