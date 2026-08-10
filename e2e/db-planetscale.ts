import { execFileSync } from 'node:child_process'
import { worktreeKey } from './db-identity.ts'
import { reconcileAndMigrate, truncateAppData } from './db-migrate.ts'
import type { E2eDbState } from './db-types.ts'

function mustEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) {
    throw new Error(
      `${name} is required for E2E_DB_BACKEND=planetscale (set org/database/service token)`,
    )
  }
  return v
}

function pscale(args: string[]): string {
  const org = mustEnv('PLANETSCALE_ORG')
  const token = process.env['PLANETSCALE_SERVICE_TOKEN']
  const tokenId = process.env['PLANETSCALE_SERVICE_TOKEN_ID']
  const authArgs =
    token && tokenId
      ? ['--service-token', token, '--service-token-id', tokenId]
      : []

  try {
    return execFileSync(
      'pscale',
      [...args, '--org', org, ...authArgs, '--format', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    ).trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.includes('pscale')) {
      throw new Error(
        'pscale CLI not found. Install PlanetScale CLI and auth, or use E2E_DB_BACKEND=docker.',
        { cause: err },
      )
    }
    throw err
  }
}

function pscaleText(args: string[]): void {
  const org = mustEnv('PLANETSCALE_ORG')
  const token = process.env['PLANETSCALE_SERVICE_TOKEN']
  const tokenId = process.env['PLANETSCALE_SERVICE_TOKEN_ID']
  const authArgs =
    token && tokenId
      ? ['--service-token', token, '--service-token-id', tokenId]
      : []
  execFileSync('pscale', [...args, '--org', org, ...authArgs], {
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  })
}

function branchExists(database: string, branch: string): boolean {
  try {
    pscale(['branch', 'show', database, branch])
    return true
  } catch {
    return false
  }
}

type RoleCreateJson = {
  id?: string
  name?: string
  username?: string
  password?: string
  access_host_url?: string
  host?: string
  database_name?: string
  connection_string?: string
  connectionString?: string
}

function roleToDatabaseUrl(role: RoleCreateJson): string {
  const direct = role.connection_string ?? role.connectionString
  if (direct) return direct.replace(/^['"]|['"]$/g, '')

  const user = role.username
  const password = role.password
  const host = role.access_host_url ?? role.host
  const dbName = role.database_name ?? 'postgres'
  if (!user || !password || !host) {
    throw new Error(
      `pscale role create returned unexpected JSON (need username/password/host or connection_string): ${JSON.stringify(role)}`,
    )
  }
  const encodedUser = encodeURIComponent(user)
  const encodedPass = encodeURIComponent(password)
  return `postgresql://${encodedUser}:${encodedPass}@${host}:6432/${dbName}?sslmode=require`
}

function createRoleUrl(database: string, branch: string): string {
  const roleName = `e2e-${Date.now()}`
  console.log(`[e2e:db] creating PlanetScale role ${roleName} on ${branch}`)
  const raw = pscale([
    'role',
    'create',
    database,
    branch,
    roleName,
    '--inherited-roles',
    'postgres',
    '--ttl',
    '2h',
  ])
  const role = JSON.parse(raw) as RoleCreateJson
  return roleToDatabaseUrl(role)
}

export async function setupPlanetScaleDatabase(): Promise<E2eDbState> {
  const database = mustEnv('PLANETSCALE_DATABASE')
  const org = mustEnv('PLANETSCALE_ORG')

  const ephemeral =
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1' ||
    process.env['E2E_DB_EPHEMERAL'] === '1'

  const id = ephemeral
    ? `ci-${process.env['GITHUB_RUN_ID'] ?? Date.now()}-${process.env['GITHUB_RUN_ATTEMPT'] ?? '1'}`
    : `wt-${worktreeKey()}`
  const branch = `e2e-${id}`

  if (!branchExists(database, branch)) {
    console.log(`[e2e:db] creating PlanetScale branch ${branch}`)
    // --wait is not always paired with json; use text for create
    pscaleText([
      'branch',
      'create',
      database,
      branch,
      '--from',
      'main',
      '--wait',
    ])
  } else {
    console.log(`[e2e:db] reusing PlanetScale branch ${branch}`)
  }

  const databaseUrl = createRoleUrl(database, branch)
  await reconcileAndMigrate(databaseUrl)
  if (!ephemeral) {
    await truncateAppData(databaseUrl)
  }

  return {
    backend: 'planetscale',
    id: branch,
    databaseUrl,
    planetscaleBranch: branch,
    planetscaleDatabase: database,
    planetscaleOrg: org,
  }
}

export async function disposePlanetScaleDatabase(
  state: E2eDbState,
): Promise<void> {
  const ephemeral =
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1' ||
    process.env['E2E_DB_EPHEMERAL'] === '1'

  if (
    ephemeral &&
    state.planetscaleBranch &&
    state.planetscaleDatabase &&
    state.planetscaleOrg
  ) {
    console.log(
      `[e2e:db] deleting PlanetScale branch ${state.planetscaleBranch}`,
    )
    try {
      pscaleText([
        'branch',
        'delete',
        state.planetscaleDatabase,
        state.planetscaleBranch,
        '--force',
      ])
    } catch (err) {
      console.error(
        '[e2e:db] failed to delete branch (will need reaper):',
        err instanceof Error ? err.message : err,
      )
    }
    return
  }

  await truncateAppData(state.databaseUrl)
}
