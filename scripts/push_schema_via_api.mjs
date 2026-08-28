/**
 * scripts/push_schema_via_api.mjs
 * Pushes the complete SQL schema to Supabase using the Management API.
 * Usage: node scripts/push_schema_via_api.mjs <SUPABASE_PERSONAL_ACCESS_TOKEN>
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const PROJECT_REF = 'qeagqbieiftkvwjbgeqj'
const ACCESS_TOKEN = process.argv[2]

if (!ACCESS_TOKEN) {
  console.error(`
❌ No personal access token provided!

Get your token from: https://supabase.com/dashboard/account/tokens
Then run: node scripts/push_schema_via_api.mjs <YOUR_TOKEN>
`)
  process.exit(1)
}

const sql = readFileSync(resolve('supabase/complete_schema_and_seed.sql'), 'utf8')

console.log(`📤 Pushing schema to Supabase project: ${PROJECT_REF} ...`)
console.log(`📄 SQL size: ${(sql.length / 1024).toFixed(1)} KB`)

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ query: sql }),
})

const text = await res.text()

if (res.ok) {
  console.log('✅ Schema applied successfully!')
  
  // Now verify a few tables
  const verifyRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `,
    }),
  })
  const verifyData = await verifyRes.json()
  console.log('\n✅ Tables in database:', verifyData.map ? verifyData.map(r => r.table_name) : verifyData)
} else {
  console.error('❌ Failed:', res.status, res.statusText)
  try {
    const parsed = JSON.parse(text)
    console.error('Error details:', JSON.stringify(parsed, null, 2))
  } catch {
    console.error('Raw response:', text.slice(0, 500))
  }
}
