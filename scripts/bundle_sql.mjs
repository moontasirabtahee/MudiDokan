import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const MIGRATIONS_DIR = resolve('supabase/migrations')
const SEED_FILE = resolve('supabase/seed.sql')
const OUTPUT_FILE = resolve('supabase/complete_schema_and_seed.sql')

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let combinedSql = `-- ============================================================================
-- MUDIDOKAN COMPLETE DATABASE SCHEMA, RLS, FUNCTIONS & SEED DATA
-- Run this entire script in your Supabase Project -> SQL Editor -> New Query
-- ============================================================================

`

for (const file of files) {
  combinedSql += `\n-- ----------------------------------------------------------------------------\n`
  combinedSql += `-- Migration: ${file}\n`
  combinedSql += `-- ----------------------------------------------------------------------------\n\n`
  combinedSql += readFileSync(join(MIGRATIONS_DIR, file), 'utf8') + '\n'
}

combinedSql += `\n-- ----------------------------------------------------------------------------\n`
combinedSql += `-- Seed Data: seed.sql\n`
combinedSql += `-- ----------------------------------------------------------------------------\n\n`
combinedSql += readFileSync(SEED_FILE, 'utf8') + '\n'

writeFileSync(OUTPUT_FILE, combinedSql, 'utf8')
console.log(`✅ Generated ${OUTPUT_FILE} (${Math.round(combinedSql.length / 1024)} KB)`)
