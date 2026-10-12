import { stripVTControlCharacters } from 'node:util'

export function redactDshSecrets(value: string, secrets: readonly string[] = []): string {
  let text = stripVTControlCharacters(value)
  for (const secret of secrets) {
    if (secret !== '') text = text.split(secret).join('[redacted]')
  }
  return text
    .replace(/([?&](?:token|access_token|refresh_token|api[_-]?key|client_secret)=)[^\s&#"']*/gi, '$1[redacted]')
    // A *quoted* value: `"cookie":"…"`, `'authorization': 'Bearer …'`. The whole
    // value goes, including a `Bearer ` prefix, which is why this runs before the
    // unquoted rule below.
    .replace(/(["']?(?:authorization|cookie|set-cookie|token|access_token|refresh_token|api[_-]?key|client_secret|deepseek_api_key)["']?\s*[:=]\s*)(["'])(?:[^"'\\]|\\.)*\2/gi,
      '$1$2[redacted]$2')
    // An unquoted value runs to the end of the line: a header, an assignment, or a
    // JSON field whose name was quoted but whose value was not. The rule this
    // replaces required a colon directly after the name, so `cookie="…"`,
    // `cookie=…` and `{"cookie":"…"}` reached the output channel verbatim.
    .replace(/(^|[^\w"'])(["']?(?:authorization|cookie|set-cookie|token|access_token|refresh_token|api[_-]?key|client_secret|deepseek_api_key)["']?\s*[:=]\s*)(?!["'\[])(?!\[redacted\])(\S[^\r\n]*)/gi,
      '$1$2[redacted]')
    .replace(/(--(?:token|access-token|refresh-token|api-key|client-secret|password)(?:["']?\s+|=))(["']?)([^\s"']+)\2/gi,
      '$1$2[redacted]$2')
}

/** Buffer before logging: a token (or even the word `token`) can span chunks. */
export class RuntimeOutput {
  private buffer = ''
  private discarding = false

  constructor(
    private readonly log: (line: string) => void,
    private readonly accept: (line: string) => void,
    private readonly maxLineLength = 65_536,
  ) {}

  consume(chunk: string): void {
    // Split first so even a very large incoming chunk never becomes retained state.
    const parts = chunk.split(/\r\n|\r|\n/)
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index] ?? ''
      if (!this.discarding) {
        if (this.buffer.length + part.length > this.maxLineLength) {
          this.buffer = ''
          this.discarding = true
          this.log('[runtime] oversized output line omitted')
        } else {
          this.buffer += part
        }
      }
      if (index < parts.length - 1) this.flush()
    }
  }

  flush(): void {
    const line = this.buffer
    this.buffer = ''
    if (this.discarding) {
      this.discarding = false
      return
    }
    if (line === '') return
    this.log(redactDshSecrets(line))
    this.accept(stripVTControlCharacters(line))
  }
}
