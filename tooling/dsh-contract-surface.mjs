/** Read RPC names from released legacy descriptors and current Typert method tables. */
export function methodsOf(source) {
  if (source === undefined) return undefined
  const methods = new Set([...source.matchAll(/id:\s*['"][^#'"]+#([A-Za-z0-9_]+\/[A-Za-z0-9_]+)['"]/g)].map(match => match[1]))
  for (const match of source.matchAll(/^ {4}['"]([A-Za-z0-9_]+\/[A-Za-z0-9_]+)['"]:\s*\{/gm)) methods.add(match[1])
  if (methods.size === 0 && !/\bmethods:\s*(?:\[\s*\]|\{\s*\})/.test(source)) {
    throw new Error('Unrecognized DSH Remote descriptor: no RPC methods could be read.')
  }
  return methods
}
