export interface SubagentCatalogRead {
  status: 'loading' | 'ready' | 'error' | 'migration-required'
  error?: string
}
