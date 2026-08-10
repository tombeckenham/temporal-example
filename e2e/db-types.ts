export type E2eDbBackend = 'docker' | 'planetscale'

export type E2eDbState = {
  backend: E2eDbBackend
  id: string
  databaseUrl: string
  /** PlanetScale only: branch name to delete on dispose */
  planetscaleBranch?: string
  planetscaleDatabase?: string
  planetscaleOrg?: string
}
