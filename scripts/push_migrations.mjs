/**
 * scripts/push_migrations.mjs
 * Connects directly to Supabase PostgreSQL and runs all migrations + seed.
 */
import pg from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const { Client } = pg

const config = {
  host: 'aws-0-ap-northeast-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.thxzleivoisitljfkwfu',
  password: 'Ts+bH_%V8!wZR_h',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
}

const MIGRATIONS_DIR = resolve('supabase/migrations')
const SEED_FILE = resolve('supabase/seed.sql')

async function main() {
  console.log('Connecting to Supabase PostgreSQL at aws-0-ap-northeast-1.pooler.supabase.com...')
  const client = new Client(config)
  await client.connect()
  console.log('✅ Connected to database!\n')

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`Running ${files.length} migration files...\n`)

  for (const file of files) {
    try {
      console.log(`Executing ${file}...`)
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      await client.query(sql)
      console.log(`✓ ${file}`)
    } catch (err) {
      console.error(`✗ ${file}: ${err.message}`)
      await client.end()
      process.exit(1)
    }
  }

  console.log('\nRunning seed.sql...')
  try {
    const seedSql = readFileSync(SEED_FILE, 'utf8')
    await client.query(seedSql)
    console.log('✓ seed.sql')
  } catch (err) {
    console.error(`✗ seed.sql: ${err.message}`)
    await client.end()
    process.exit(1)
  }

  await client.end()
  console.log('\n🎉 ALL MIGRATIONS AND SEED APPLIED SUCCESSFULLY!')
  console.log('You can now log in at http://localhost:5173 with:')
  console.log('   Email: demo@mudidokan.app')
  console.log('   Password: mudidokan')
}

main().catch((err) => {
  console.error('Connection/Execution error:', err)
  process.exit(1)
})
