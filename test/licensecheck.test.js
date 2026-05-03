const assert = require('assert')
const path = require('path')

// Patch child_process.execFile before loading the module so promisify captures the mock
let mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":"MIT"}' })
require('child_process').execFile = (...args) => mockExecImpl(...args)

const { fetchLicense, classify, applyOverride, licenseCheck } = require('../index')

const FIXTURES = path.join(__dirname, 'fixtures')
const POLICY   = path.join(FIXTURES, 'policy.json')

// Returns license based on package name for fixture packages
const fixtureExec = (cmd, args, cb) => {
  const licenses = { 'pkg-mit': 'MIT', 'pkg-isc': 'ISC', 'pkg-gpl': 'GPL-3.0', 'pkg-lgpl': 'LGPL-3.0' }
  const pkg = args[1]
  const license = licenses[pkg]
  cb(null, { stdout: JSON.stringify(license ? { license } : {}) })
}

// Runs licenseCheck with given argv, captures console.log output and exit code
async function run(args) {
  const lines = []
  let exitCode = null
  const origArgv = process.argv
  const origLog  = console.log
  const origExit = process.exit
  process.argv  = ['node', 'index.js', ...args]
  console.log   = (...a) => lines.push(a.join(' '))
  process.exit  = (code) => { exitCode = code }
  try { await licenseCheck() } finally {
    process.argv  = origArgv
    console.log   = origLog
    process.exit  = origExit
  }
  return { output: lines.join('\n'), exitCode }
}

// ─── classify ────────────────────────────────────────────────────────────────

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

  it('does NOT match when license is less specific than policy entry (Apache vs Apache-2.0)', () => {
    assert.strictEqual(classify('Apache', policy), 'unknown')
  })

  it('matches when license is more specific than policy entry (Apache-2.0 matches policy Apache)', () => {
    const loosePolicy = { allowed: ['Apache'], warn: [], forbidden: [] }
    assert.strictEqual(classify('Apache-2.0', loosePolicy), 'allowed')
  })

  it('matches GPL-3.0-only against forbidden GPL-3.0', () => {
    assert.strictEqual(classify('GPL-3.0-only', policy), 'forbidden')
  })
})

// ─── fetchLicense ─────────────────────────────────────────────────────────────

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

  it('normalizes license object { type, url } to a string', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":{"type":"MIT","url":"https://example.com"}}' })
    const result = await fetchLicense({ package: 'old-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'old-pkg', license: 'MIT' })
  })

  it('normalizes license array to a comma-separated string', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":["MIT","Apache-2.0"]}' })
    const result = await fetchLicense({ package: 'multi-pkg', version: '^1.0.0' })
    assert.deepStrictEqual(result, { package: 'multi-pkg', license: 'MIT, Apache-2.0' })
  })

  it('falls back to licenses[] field when license is absent (old npm format)', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"licenses":["MIT"]}' })
    const result = await fetchLicense({ package: 'html5-history-api', version: '^4.0.0' })
    assert.deepStrictEqual(result, { package: 'html5-history-api', license: 'MIT' })
  })
})

// ─── applyOverride ────────────────────────────────────────────────────────────

describe('applyOverride', () => {
  const freshDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) // 30 days ago
  const expiredDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) // 400 days ago

  const overrides = {
    'html5shiv': { license: 'MIT', approvedBy: 'MP', approvedAt: freshDate, reason: 'Confirmed on GitHub' }
  }

  it('does not apply override when license was auto-detected', () => {
    const item = { package: 'html5shiv', license: 'MIT', status: 'allowed' }
    const result = applyOverride(item, overrides)
    assert.strictEqual(result.override, undefined)
  })

  it('applies override when license is n/a', () => {
    const item = { package: 'html5shiv', license: 'n/a', status: 'unknown' }
    const result = applyOverride(item, overrides)
    assert.strictEqual(result.license, 'MIT')
    assert.ok(result.override)
  })

  it('returns override-expired when override is older than 1 year', () => {
    const expiredOverrides = {
      'html5shiv': { license: 'MIT', approvedBy: 'MP', approvedAt: expiredDate }
    }
    const item = { package: 'html5shiv', license: 'n/a', status: 'unknown' }
    const result = applyOverride(item, expiredOverrides)
    assert.strictEqual(result.status, 'override-expired')
    assert.ok(result.override)
  })

  it('does not apply override when no entry exists for the package', () => {
    const item = { package: 'unknown-pkg', license: 'n/a', status: 'unknown' }
    const result = applyOverride(item, overrides)
    assert.strictEqual(result.license, 'n/a')
    assert.strictEqual(result.override, undefined)
  })

  it('handles empty overrides object', () => {
    const item = { package: 'html5shiv', license: 'n/a', status: 'unknown' }
    const result = applyOverride(item, {})
    assert.strictEqual(result.license, 'n/a')
  })
})

// ─── licenseCheck – markdown output ──────────────────────────────────────────

describe('licenseCheck (markdown, no config)', () => {
  let output

  before(async () => {
    mockExecImpl = fixtureExec
    ;({ output } = await run([FIXTURES]))
  })

  it('includes the repo name in the heading', () => {
    assert.ok(output.includes('AC License Report – test-repo'), `heading missing in:\n${output}`)
  })

  it('does NOT include a Status column', () => {
    assert.ok(!output.includes('|Status|'), `Status column should be absent:\n${output}`)
  })

  it('includes license names', () => {
    assert.ok(output.includes('MIT'), `MIT missing in:\n${output}`)
  })

  it('includes total and analyzed counts', () => {
    assert.ok(output.includes('|Total|6|'), `Total missing in:\n${output}`)
    assert.ok(output.includes('|Analyzed|6|'), `Analyzed missing in:\n${output}`)
  })
})

describe('licenseCheck (markdown, with config)', () => {
  let output

  before(async () => {
    mockExecImpl = fixtureExec
    ;({ output } = await run([FIXTURES, `--config=${POLICY}`]))
  })

  it('includes a Status column', () => {
    assert.ok(output.includes('|Status|'), `Status column missing in:\n${output}`)
  })

  it('shows allowed status for MIT', () => {
    assert.ok(output.includes('MIT') && output.includes('allowed'), `allowed status missing in:\n${output}`)
  })

  it('shows forbidden status for GPL-3.0', () => {
    assert.ok(output.includes('GPL-3.0') && output.includes('forbidden'), `forbidden status missing in:\n${output}`)
  })

  it('shows warn status for LGPL-3.0', () => {
    assert.ok(output.includes('LGPL-3.0') && output.includes('warn'), `warn status missing in:\n${output}`)
  })

  it('includes a Violations section for forbidden licenses', () => {
    assert.ok(output.includes('Violations'), `Violations section missing in:\n${output}`)
    assert.ok(output.includes('pkg-gpl'), `pkg-gpl missing in violations:\n${output}`)
  })

  it('includes a Warnings section for warn licenses', () => {
    assert.ok(output.includes('Warnings'), `Warnings section missing in:\n${output}`)
    assert.ok(output.includes('pkg-lgpl'), `pkg-lgpl missing in warnings:\n${output}`)
  })
})

// ─── licenseCheck – JSON output ───────────────────────────────────────────────

describe('licenseCheck (JSON mode)', () => {
  let parsed

  before(async () => {
    mockExecImpl = fixtureExec
    const { output } = await run([FIXTURES, '--json', `--config=${POLICY}`])
    parsed = JSON.parse(output)
  })

  it('has the correct top-level keys', () => {
    for (const key of ['repository', 'date', 'total', 'analyzed', 'violations', 'warnings', 'unknowns', 'expired', 'report']) {
      assert.ok(key in parsed, `missing key: ${key}`)
    }
  })

  it('sets repository to the package name', () => {
    assert.strictEqual(parsed.repository, 'test-repo')
  })

  it('sets total and analyzed correctly', () => {
    assert.strictEqual(parsed.total, 6)
    assert.strictEqual(parsed.analyzed, 6)
  })

  it('each report item has package, license, and status fields', () => {
    for (const item of parsed.report) {
      assert.ok('package' in item, 'missing package field')
      assert.ok('license' in item, 'missing license field')
      assert.ok('status' in item, 'missing status field')
    }
  })

  it('violations contains the GPL package', () => {
    assert.ok(parsed.violations.some(v => v.package === 'pkg-gpl'), 'pkg-gpl not in violations')
  })

  it('warnings contains the LGPL package', () => {
    assert.ok(parsed.warnings.some(w => w.package === 'pkg-lgpl'), 'pkg-lgpl not in warnings')
  })

  it('date is a valid ISO string', () => {
    assert.ok(!isNaN(Date.parse(parsed.date)), `invalid date: ${parsed.date}`)
  })

  it('applies a valid override for pkg-nolicense and classifies it as allowed', () => {
    const item = parsed.report.find(r => r.package === 'pkg-nolicense')
    assert.ok(item, 'pkg-nolicense missing from report')
    assert.strictEqual(item.license, 'MIT')
    assert.strictEqual(item.status, 'allowed')
    assert.ok(item.override, 'override metadata missing')
  })
})

// ─── licenseCheck – error handling ───────────────────────────────────────────

describe('licenseCheck (invalid config path)', () => {
  it('logs an error and continues with empty policy when config file is missing', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":"MIT"}' })
    const errors = []
    const origError = console.error
    console.error = (...args) => errors.push(args.join(' '))
    const { output } = await run([FIXTURES, '--config=/nonexistent/policy.json'])
    console.error = origError
    assert.ok(errors.some(e => e.includes('Could not load license policy')), 'expected error log missing')
    assert.ok(output.includes('AC License Report'), 'report should still be generated')
  })
})

// ─── licenseCheck – exit code ─────────────────────────────────────────────────

describe('licenseCheck (exit code)', () => {
  it('exits with code 1 when forbidden licenses are found', async () => {
    mockExecImpl = fixtureExec
    const { exitCode } = await run([FIXTURES, '--json', `--config=${POLICY}`])
    assert.strictEqual(exitCode, 1)
  })

  it('does not call process.exit when there are no violations', async () => {
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{"license":"MIT"}' })
    const { exitCode } = await run([FIXTURES, '--json', `--config=${POLICY}`])
    assert.strictEqual(exitCode, null)
  })

  it('exits with code 1 when an override has expired', async () => {
    const path = require('path')
    const os   = require('os')
    const { writeFileSync, mkdtempSync } = require('fs')
    const expiredDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lc-test-'))
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-expired', dependencies: { 'no-license-pkg': '^1.0.0' }
    }))
    const expiredPolicy = path.join(tmpDir, 'policy.json')
    writeFileSync(expiredPolicy, JSON.stringify({
      allowed: ['MIT'], warn: [], forbidden: [],
      overrides: { 'no-license-pkg': { license: 'MIT', approvedBy: 'MP', approvedAt: expiredDate } }
    }))
    mockExecImpl = (cmd, args, cb) => cb(null, { stdout: '{}' }) // no license field
    const { exitCode } = await run([tmpDir, '--json', `--config=${expiredPolicy}`])
    assert.strictEqual(exitCode, 1)
  })
})
