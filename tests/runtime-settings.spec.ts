import { describe, expect, it } from 'vitest'
import {
  MAX_RUNTIME_SCHEMA_DEPTH,
  MAX_RUNTIME_SETTING_FIELDS,
  parseRuntimeSetting,
  runtimeSettingFields,
  settingConstantOptions,
  type SettingsNamespace,
  type SettingsSchemaNode,
} from '../src/runtime-settings.js'

const namespace: SettingsNamespace = {
  ns: 'example-plugin',
  schema: {
    uid: 8,
    refs: {
      '1': { type: 'const', value: 'off' },
      '2': { type: 'const', value: 'on' },
      '3': { type: 'union', list: [1, 2] },
      '4': { type: 'number', meta: { min: 1, max: 10 } },
      '5': { type: 'string', meta: { role: 'secret' } },
      '6': { type: 'object', dict: { limit: 4 } },
      '8': { type: 'object', dict: { mode: 3, nested: 6, token: 5 } },
    },
  },
  value: { mode: 'on', nested: { limit: 4 } },
  base: { mode: 'off', nested: { limit: 2 } },
  user: { mode: 'on', nested: { limit: 4 } },
  applies: 'restart',
  secrets: [{ path: ['token'], set: true }],
  revision: 7,
}

describe('runtime settings schemas', () => {
  it('flattens Schemastery object fields while preserving overrides and redacted secrets', () => {
    const fields = runtimeSettingFields(namespace)

    expect(fields.map(field => field.path.join('.'))).toEqual(['mode', 'nested.limit', 'token'])
    expect(fields[0]).toMatchObject({ value: 'on', inherited: 'off', overridden: true })
    expect(fields[2]).toMatchObject({ value: undefined, overridden: false, secretSet: true })
    expect(settingConstantOptions(fields[0]!, namespace.schema)).toEqual(['off', 'on'])
  })

  it('parses and validates typed setting input', () => {
    const numberField = runtimeSettingFields(namespace)[1]!
    expect(parseRuntimeSetting(numberField, '8')).toBe(8)
    expect(() => parseRuntimeSetting(numberField, '0')).toThrow('at least 1')
    expect(() => parseRuntimeSetting(numberField, 'not-a-number')).toThrow('valid number')
  })

  it('refuses an emptied number box instead of writing zero', () => {
    // Number('') is 0 and passes every min/max check, so clearing the field
    // would silently apply a zero the user never typed.
    const field = { path: ['temperature'], node: { type: 'number', meta: { min: 0, max: 1 } }, value: 0.1, inherited: 0.1, overridden: false }
    expect(() => parseRuntimeSetting(field as never, '')).toThrow('Enter a valid number.')
    expect(() => parseRuntimeSetting(field as never, '   ')).toThrow('Enter a valid number.')
    expect(parseRuntimeSetting(field as never, '0')).toBe(0)
  })
})

describe('hostile settings schemas', () => {
  it('skips a self-referencing schema instead of recursing forever', () => {
    const cyclic: SettingsNamespace = {
      ns: 'cyclic-plugin',
      schema: {
        uid: 1,
        refs: {
          '1': { type: 'object', dict: { self: 1, ok: 2 } },
          '2': { type: 'string' },
        },
      },
      value: { ok: 'readable' },
      base: {},
      user: {},
      applies: 'live',
      secrets: [],
      revision: 1,
    }
    expect(runtimeSettingFields(cyclic).map(field => field.path.join('.'))).toEqual(['ok'])
  })

  it('stops at the schema depth bound instead of throwing', () => {
    const refs: Record<string, SettingsSchemaNode> = {}
    for (let uid = 1; uid <= MAX_RUNTIME_SCHEMA_DEPTH + 20; uid++) {
      refs[String(uid)] = { type: 'object', dict: { next: uid + 1 } }
    }
    refs[String(MAX_RUNTIME_SCHEMA_DEPTH + 21)] = { type: 'string' }
    const deep: SettingsNamespace = {
      ns: 'deep-plugin',
      schema: { uid: 1, refs },
      value: {},
      base: {},
      user: {},
      applies: 'live',
      secrets: [],
      revision: 1,
    }
    expect(runtimeSettingFields(deep)).toEqual([])
  })

  it('stops after the field cap for a wide schema', () => {
    const dict: Record<string, number> = {}
    for (let index = 0; index <= MAX_RUNTIME_SETTING_FIELDS; index++) dict[`field-${String(index)}`] = 999
    const wide: SettingsNamespace = {
      ns: 'wide-plugin',
      schema: { uid: 1, refs: { '1': { type: 'object', dict }, '999': { type: 'string' } } },
      value: {},
      base: {},
      user: {},
      applies: 'live',
      secrets: [],
      revision: 1,
    }
    expect(runtimeSettingFields(wide)).toHaveLength(MAX_RUNTIME_SETTING_FIELDS)
  })
})
