const assert = require('assert')

// Patch child_process.execFile before loading the module so promisify captures the mock
let mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":"MIT"}' })
require('child_process').execFile = (...args) => mockExecImpl(...args)

const { fetchLicense, classify } = require('../index')

describe('classify', () => {
  const policy = {
    allowed:   ['MIT', 'ISC', 'Apache-2.0'],
    warn:      ['LGPL-3.0', 'MPL-2.0'],
    forbidden: ['GPL-3.0', 'AGPL-3.0']
  }

  it('returns allowed for a matching allowed license', () => {
    assert.strictEqual(classify('MIT', policy), 'allowed')
  })

  it('returns warn for a matching warn license', () => {
    assert.strictEqual(classify('LGPL-3.0', policy), 'warn')
  })

  it('returns forbidden for a matching forbidden license', () => {
    assert.strictEqual(classify('GPL-3.0', policy), 'forbidden')
  })

  it('returns private for "Private package"', () => {
    assert.strictEqual(classify('Private package', policy), 'private')
  })

  it('returns unknown when no policy matches', () => {
    assert.strictEqual(classify('Unlicense', policy), 'unknown')
  })

  it('is case-insensitive', () => {
    assert.strictEqual(classify('mit', policy), 'allowed')
    assert.strictEqual(classify('gpl-3.0', policy), 'forbidden')
    assert.strictEqual(classify('MPL-2.0', policy), 'warn')
  })

  it('returns unknown with empty policy', () => {
    assert.strictEqual(classify('MIT'), 'unknown')
  })
})

describe('fetchLicense', () => {
  it('returns "Private package" for git+ssh versions', async () => {
    const result = await fetchLicense({ package: 'my-private', version: 'git+ssh://git@github.com/org/repo.git' })
    assert.deepStrictEqual(result, { package: 'my-private', license: 'Private package' })
  })

  it('returns the license from npm info', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":"ISC"}' })
    const result = await fetchLicense({ package: 'some-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'some-pkg', license: 'ISC' })
  })

  it('returns "n/a" when license field is missing', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"name":"some-pkg","version":"1.0.0"}' })
    const result = await fetchLicense({ package: 'some-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'some-pkg', license: 'n/a' })
  })

  it('returns "n/a" when execFile throws', async () => {
    mockExecImpl = (cmd, args, cb) => cb(new Error('network error'))
    const result = await fetchLicense({ package: 'broken-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'broken-pkg', license: 'n/a' })
  })

  it('returns "n/a" when npm returns invalid JSON', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: 'not json' })
    const result = await fetchLicense({ package: 'bad-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'bad-pkg', license: 'n/a' })
  })
})
