/**
 * E2E orchestrator:
 * 1. Backup .dev.vars
 * 2. Provision isolated Postgres (Docker worktree / PlanetScale CI)
 * 3. Write .dev.vars with DATABASE_URL
 * 4. Run Playwright
 * 5. Dispose DB + restore .dev.vars
 */
import { execSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import {
  E2E_DB_STATE_PATH,
  E2E_DEV_VARS_BACKUP_PATH,
  E2E_PORTS,
  E2E_SECRETS,
} from './constants.ts'
import {
  disposeE2eDatabase,
  setupE2eDatabase,
  type E2eDbState,
} from './db-setup.ts'

const DEV_VARS_PATH = '.dev.vars'

function backupDevVars(): void {
  if (existsSync(DEV_VARS_PATH)) {
    copyFileSync(DEV_VARS_PATH, E2E_DEV_VARS_BACKUP_PATH)
  } else if (existsSync(E2E_DEV_VARS_BACKUP_PATH)) {
    unlinkSync(E2E_DEV_VARS_BACKUP_PATH)
  }
}

function restoreDevVars(): void {
  if (existsSync(E2E_DEV_VARS_BACKUP_PATH)) {
    copyFileSync(E2E_DEV_VARS_BACKUP_PATH, DEV_VARS_PATH)
    unlinkSync(E2E_DEV_VARS_BACKUP_PATH)
    console.log('[e2e] restored .dev.vars from backup')
    return
  }
  if (existsSync(DEV_VARS_PATH)) {
    const body = readFileSync(DEV_VARS_PATH, 'utf8')
    if (body.includes('e2e/run.ts') || body.includes('prepare-dev-vars')) {
      unlinkSync(DEV_VARS_PATH)
      console.log('[e2e] removed e2e-generated .dev.vars')
    }
  }
}

async function prepareDevVarsAsync(databaseUrl: string): Promise<void> {
  process.env['DATABASE_URL'] = databaseUrl
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bun', ['run', 'e2e/prepare-dev-vars.ts'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: process.cwd(),
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`prepare-dev-vars exited ${code}`))
    })
  })
}

function runPlaywright(
  databaseUrl: string,
  extraArgs: string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bunx', ['playwright', 'test', ...extraArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        E2E_FIXED_OTP: '1',
        E2E_TEST_SECRET: E2E_SECRETS.E2E_TEST_SECRET,
        TEMPORAL_STARTER_SECRET: E2E_SECRETS.TEMPORAL_STARTER_SECRET,
        TEMPORAL_STARTER_URL: `http://127.0.0.1:${E2E_PORTS.gateway}`,
        STATUS_WEBHOOK_SECRET: E2E_SECRETS.STATUS_WEBHOOK_SECRET,
        EMAIL_MODE: 'console',
      },
      cwd: process.cwd(),
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

let state: E2eDbState | undefined

function freeListenPort(port: number): void {
  try {
    execSync(
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
      { stdio: 'ignore' },
    )
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const playwrightArgs = process.argv.slice(2).filter((a) => a !== '--')
  backupDevVars()

  try {
    state = await setupE2eDatabase()
    await prepareDevVarsAsync(state.databaseUrl)
    // Free only the e2e app port (3100) — leave local dev on :3000 alone.
    freeListenPort(E2E_PORTS.app)

    const code = await runPlaywright(state.databaseUrl, playwrightArgs)
    process.exitCode = code
  } catch (err) {
    console.error('[e2e] run failed:', err)
    process.exitCode = 1
  } finally {
    if (state) {
      try {
        await disposeE2eDatabase(state)
      } catch (err) {
        console.error('[e2e] db dispose failed:', err)
      }
    } else if (existsSync(E2E_DB_STATE_PATH)) {
      try {
        const raw = readFileSync(E2E_DB_STATE_PATH, 'utf8')
        await disposeE2eDatabase(JSON.parse(raw) as E2eDbState)
      } catch (err) {
        console.error('[e2e] db dispose from state file failed:', err)
      }
    }
    try {
      if (existsSync(E2E_DB_STATE_PATH)) unlinkSync(E2E_DB_STATE_PATH)
    } catch {
      // ignore
    }
    restoreDevVars()
  }
}

await main()
