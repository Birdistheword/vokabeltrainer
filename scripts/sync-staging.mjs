#!/usr/bin/env node
/**
 * One-way data sync: PRODUCTION → STAGING
 *
 * Reads PROD_DB_URL and STAGING_DB_URL from .env.local
 * For every table in the public schema:
 *   1. Truncates the staging copy
 *   2. Copies all rows from production
 *
 * FK constraints are disabled during inserts via session_replication_role=replica
 * so dependency order doesn't matter and orphan auth references don't fail.
 *
 * NOTE: this only syncs the public schema. auth.users is NOT touched —
 * each Supabase project has its own auth domain. See README in this folder
 * for the test-account workflow.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import pg from 'pg'

const { Client } = pg

const PROD_URL = process.env.PROD_DB_URL
const STAGING_URL = process.env.STAGING_DB_URL

if (!PROD_URL || !STAGING_URL) {
  console.error('❌ Missing PROD_DB_URL or STAGING_DB_URL in .env.local')
  process.exit(1)
}
if (PROD_URL === STAGING_URL) {
  console.error('❌ PROD_DB_URL and STAGING_DB_URL are identical — refusing to run (would wipe production!)')
  process.exit(1)
}

// Safety: confirm we're really hitting staging by checking the host doesn't match prod's project ref
const prodHost = new URL(PROD_URL).hostname
const stagingHost = new URL(STAGING_URL).hostname
if (stagingHost === prodHost) {
  console.error('❌ Staging hostname matches production hostname — refusing to run')
  process.exit(1)
}

console.log(`📡 PROD:    ${prodHost}`)
console.log(`📡 STAGING: ${stagingHost}\n`)

const CHUNK_SIZE = 500 // rows per INSERT batch

async function main() {
  const prod = new Client({ connectionString: PROD_URL })
  const staging = new Client({ connectionString: STAGING_URL })

  await prod.connect()
  await staging.connect()
  console.log('🔌 Connected to both databases\n')

  // Discover tables in public schema
  const { rows: tableRows } = await prod.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `)
  const tables = tableRows.map((r) => r.tablename)
  console.log(`📋 Found ${tables.length} tables in public schema\n`)

  await staging.query('BEGIN')
  try {
    // Disable FK constraint checks for the duration of this transaction.
    // Lets us truncate and refill in any order without dependency drama.
    await staging.query(`SET session_replication_role = 'replica'`)

    console.log('🧹 Clearing staging tables...')
    for (const t of tables) {
      await staging.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`)
    }

    console.log('\n📥 Copying data:')
    for (const t of tables) {
      // Get column types so we know which need JSON stringification
      const { rows: typeInfo } = await prod.query(
        `
        SELECT column_name, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `,
        [t],
      )
      const colTypes = Object.fromEntries(typeInfo.map((r) => [r.column_name, r.udt_name]))

      const { rows } = await prod.query(`SELECT * FROM "${t}"`)
      if (rows.length === 0) {
        console.log(`  ${t.padEnd(34)} (empty)`)
        continue
      }
      const cols = Object.keys(rows[0])
      const colList = cols.map((c) => `"${c}"`).join(',')

      // pg auto-serializes most types, but jsonb/json need explicit stringify
      // (otherwise objects get sent as "[object Object]" → invalid JSON)
      const prepValue = (col, val) => {
        if (val === null || val === undefined) return val
        const t = colTypes[col]
        if ((t === 'json' || t === 'jsonb') && typeof val === 'object') {
          return JSON.stringify(val)
        }
        return val
      }

      // Insert in chunks to avoid massive single queries
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE)
        const allValues = []
        const placeholderRows = chunk.map((row, ri) => {
          const offset = ri * cols.length
          cols.forEach((c) => allValues.push(prepValue(c, row[c])))
          return `(${cols.map((_, ci) => `$${offset + ci + 1}`).join(',')})`
        })
        await staging.query(
          `INSERT INTO "${t}" (${colList}) VALUES ${placeholderRows.join(',')}`,
          allValues,
        )
      }
      console.log(`  ${t.padEnd(34)} ${rows.length} rows`)
    }

    await staging.query(`SET session_replication_role = 'origin'`)
    await staging.query('COMMIT')
    console.log('\n✅ Sync complete!\n')
    console.log('ℹ️  Reminder: log in to staging with a TEST account, not your real prod email.')
    console.log('   Synced rows reference prod auth.users IDs that don\'t exist in staging,')
    console.log('   so RLS-filtered queries (e.g. WHERE student_id = auth.uid()) will return empty')
    console.log('   for the test account until you remap a profile row to your test user ID.\n')
  } catch (e) {
    await staging.query('ROLLBACK')
    throw e
  } finally {
    await prod.end()
    await staging.end()
  }
}

main().catch((err) => {
  console.error('\n❌ Sync failed:', err.message)
  if (err.detail) console.error('   Detail:', err.detail)
  process.exit(1)
})
