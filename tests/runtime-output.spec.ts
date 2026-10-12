import { describe, expect, it } from 'vitest'
import { RuntimeOutput, redactDshSecrets } from '../src/runtime-output.ts'
import { parseDshWebUrl } from '../src/launch.ts'

describe('runtime output and launch-token privacy', () => {
  it('handles every chunk boundary without logging any part of the launch token', () => {
    const raw = '\u001b[32mdsh web: http://127.0.0.1:3080/?token=secret-token\u001b[0m\r\n'
    for (let offset = 0; offset <= raw.length; offset++) {
      const logs: string[] = []
      const urls: Array<string | undefined> = []
      const output = new RuntimeOutput(line => { logs.push(line) }, line => { urls.push(parseDshWebUrl(line)) })
      output.consume(raw.slice(0, offset))
      output.consume(raw.slice(offset))
      output.flush()
      expect(logs).toEqual(['dsh web: http://127.0.0.1:3080/?token=[redacted]'])
      expect(urls).toEqual(['http://127.0.0.1:3080/?token=secret-token'])
    }
  })

  it('flushes a final unterminated line with the same redaction', () => {
    const logs: string[] = []
    const output = new RuntimeOutput(line => { logs.push(line) }, () => {})
    output.consume('Cookie: dsh-auth-example=secret')
    expect(logs).toEqual([])
    output.flush()
    expect(logs).toEqual(['Cookie: [redacted]'])
  })

  it('discards oversized lines without leaking their prefix and resumes at a newline', () => {
    const logs: string[] = []
    const accepted: string[] = []
    const output = new RuntimeOutput(line => { logs.push(line) }, line => { accepted.push(line) }, 32)
    output.consume('token=' + 'x'.repeat(40))
    output.consume('trailing-secret\nok\n')
    expect(logs).toEqual(['[runtime] oversized output line omitted', 'ok'])
    expect(accepted).toEqual(['ok'])
  })

  it('redacts query tokens, headers and explicit secret values', () => {
    expect(redactDshSecrets('url?token=abc&x=1\nAuthorization: Bearer abc\nCookie: a=b\nplain-secret', ['plain-secret']))
      .toBe('url?token=[redacted]&x=1\nAuthorization: [redacted]\nCookie: [redacted]\n[redacted]')
  })

  it('redacts the shapes a runtime log line actually uses', () => {
    // A quote or an equals sign between the name and the colon used to slip past
    // the header rule, so a JSON field, an assignment or a quoted value reached
    // the output channel verbatim.
    expect(redactDshSecrets('{"cookie":"dsh-auth-abc=v1.secret","other":1}'))
      .toBe('{"cookie":"[redacted]","other":1}')
    expect(redactDshSecrets('{"authorization":"Bearer abc.def"}'))
      .toBe('{"authorization":"[redacted]"}')
    expect(redactDshSecrets('cookie="v1.secret" end')).toBe('cookie="[redacted]" end')
    expect(redactDshSecrets('cookie=v1.secret')).toBe('cookie=[redacted]')
    expect(redactDshSecrets('set-cookie: x=y; Path=/')).toBe('set-cookie: [redacted]')
    expect(redactDshSecrets('{"access_token":"abc"}')).toBe('{"access_token":"[redacted]"}')
    // Names that merely contain one of these words are left alone, and redacting
    // an already-redacted line changes nothing.
    expect(redactDshSecrets('mycookie=keepme cookie_monster=keepme the cookie policy was reloaded'))
      .toBe('mycookie=keepme cookie_monster=keepme the cookie policy was reloaded')
    const once = redactDshSecrets('Cookie: dsh-auth-abc=v1.secret')
    expect(once).toBe('Cookie: [redacted]')
    expect(redactDshSecrets(once)).toBe(once)
  })

  it('redacts API credentials, refresh tokens and command-line credential values', () => {
    for (const name of ['apiKey', 'api_key', 'api-key', 'DEEPSEEK_API_KEY', 'client_secret', 'refresh_token']) {
      expect(redactDshSecrets(JSON.stringify({ [name]: 'test-credential' }))).not.toContain('test-credential')
      expect(redactDshSecrets(name + '=test-credential')).not.toContain('test-credential')
    }
    expect(redactDshSecrets('url?api_key=test-credential&x=1')).toBe('url?api_key=[redacted]&x=1')
    expect(redactDshSecrets('"dsh" "--api-key" "test-credential" "web"')).toBe('"dsh" "--api-key" "[redacted]" "web"')
    expect(redactDshSecrets('dsh --token=test-credential web')).toBe('dsh --token=[redacted]')
  })
})
