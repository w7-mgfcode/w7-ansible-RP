-- Create ansible_mcp database for web-ui
-- This script runs automatically on first PostgreSQL startup

SELECT 'CREATE DATABASE ansible_mcp'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ansible_mcp')\gexec
