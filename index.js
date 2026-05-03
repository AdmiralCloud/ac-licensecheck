const { promises: fs } = require("fs")
const { execFile: execFileCb } = require("child_process")
const { promisify } = require("util")
const execFile = promisify(execFileCb)

const licenseMapping = [
  { license: 'agpl-3.0',    link: 'https://choosealicense.com/licenses/agpl-3.0/' },
  { license: 'gpl-3.0',     link: 'https://choosealicense.com/licenses/gpl-3.0/' },
  { license: 'lgpl-3.0',    link: 'https://choosealicense.com/licenses/lgpl-3.0/' },
  { license: 'mpl-2.0',     link: 'https://choosealicense.com/licenses/mpl-2.0/' },
  { license: 'bsd-2-clause',link: 'https://choosealicense.com/licenses/bsd-2-clause/' },
  { license: 'apache-2.0',  link: 'https://choosealicense.com/licenses/apache-2.0/' },
  { license: 'mit',         link: 'https://choosealicense.com/licenses/mit/' },
  { license: 'wtfpl',       link: 'https://choosealicense.com/licenses/wtfpl/' }
]

const BATCH_SIZE = 10 // parallel npm info calls
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

const matchesPolicy = (license, policyEntry) => {
  const l = license.toLowerCase()
  const p = policyEntry.toLowerCase()
  return l === p || l.startsWith(p)
}

const classify = (license, policy = { allowed: [], warn: [], forbidden: [] }) => {
  if (policy.forbidden.some(f => matchesPolicy(license, f))) return 'forbidden'
  if (policy.warn.some(w => matchesPolicy(license, w))) return 'warn'
  if (policy.allowed.some(a => matchesPolicy(license, a))) return 'allowed'
  return license === 'Private package' ? 'private' : 'unknown'
}

const applyOverride = (item, overrides = {}) => {
  // Only use override when auto-detection failed
  if (item.license !== 'n/a') return item
  const override = overrides[item.package]
  if (!override) return item

  const age = Date.now() - new Date(override.approvedAt).getTime()
  if (age > ONE_YEAR_MS) {
    return { ...item, status: 'override-expired', override }
  }

  return { ...item, license: override.license, override }
}

const normalizeLicense = (license) => {
  if (!license) return 'n/a'
  if (typeof license === 'string') return license
  if (Array.isArray(license)) return license.map(normalizeLicense).join(', ')
  if (typeof license === 'object' && license.type) return license.type
  return 'n/a'
}

const fetchLicense = async(p) => {
  if (p.version.startsWith('git+ssh')) {
    return { package: p.package, license: 'Private package' }
  }
  try {
    const response = await execFile('npm', ['info', p.package, '--json'])
    const parsed = JSON.parse(response.stdout)
    return { package: p.package, license: normalizeLicense(parsed.license) }
  }
  catch {
    return { package: p.package, license: 'n/a' }
  }
}

const licenseCheck = async() => {
  const args = process.argv.slice(2)
  const packagePath = args.find(a => !a.startsWith('--')) || '.'
  const jsonMode = args.includes('--json')
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1]

  // Load license policy if provided
  let policy = { allowed: [], warn: [], forbidden: [], overrides: {} }
  if (configPath) {
    try {
      policy = { overrides: {}, ...JSON.parse(await fs.readFile(configPath, 'utf-8')) }
    }
    catch (e) {
      console.error('Could not load license policy:', e.message)
    }
  }

  const pjson = JSON.parse(await fs.readFile(`${packagePath}/package.json`, 'utf-8'))
  const name = pjson.name

  const merged = { ...pjson.dependencies, ...pjson.devDependencies }
  const packages = Object.entries(merged).map(([pkg, version]) => ({ package: pkg, version }))
  packages.sort((a, b) => a.package.localeCompare(b.package))

  // Fetch in parallel batches
  let report = []
  if (!jsonMode) console.log(`Scanning ${packages.length} packages in batches of ${BATCH_SIZE}...`)

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const batch = packages.slice(i, i + BATCH_SIZE)
    if (!jsonMode) console.log(`Progress: ${i}/${packages.length}`)
    const results = await Promise.allSettled(batch.map(fetchLicense))
    results.forEach(r => {
      /* c8 ignore next -- fetchLicense never rejects, allSettled always fulfills */
      if (r.status === 'fulfilled') report.push(r.value)
    })
  }

  // Classify, then apply overrides for packages where auto-detection failed
  report = report
    .map(item => ({ ...item, status: classify(item.license, policy) }))
    .map(item => applyOverride(item, policy.overrides))
    .map(item => item.status === 'override-expired' ? item : { ...item, status: classify(item.license, policy) })

  const violations = report.filter(r => r.status === 'forbidden')
  const warnings   = report.filter(r => r.status === 'warn')
  const unknowns   = report.filter(r => r.status === 'unknown')
  const expired    = report.filter(r => r.status === 'override-expired')

  if (jsonMode) {
    // Machine-readable output for CI
    console.log(JSON.stringify({
      repository: name,
      date: new Date().toISOString(),
      total: packages.length,
      analyzed: report.length,
      violations,
      warnings,
      unknowns,
      expired,
      report
    }, null, 2))
  }
  else {
    // Human-readable markdown report (original behavior)
    const groups = report.reduce((acc, item) => {
      acc[item.license] = (acc[item.license] || 0) + 1
      return acc
    }, {})

    let reportText = `# AC License Report – ${name}\n`
    reportText += `|Stat|Value|\n|---|---|\n`
    reportText += `|Repository|${name}|\n|Date|${new Date().toString()}|\n`
    reportText += `|Total|${packages.length}|\n|Analyzed|${report.length}|\n`
    reportText += `|Violations|${violations.length}|\n|Warnings|${warnings.length}|\n`
    reportText += `|Expired overrides|${expired.length}|\n`
    if (configPath) {
      reportText += `\n### Licenses\n|License|Count|%|Status|Info|\n|---|---|---|---|---|\n`
      for (const [key, val] of Object.entries(groups)) {
        const link = licenseMapping.find(m => m.license === key.toLowerCase())
        const status = classify(key, policy)
        const pct = Math.round((val / packages.length) * 10000) / 100
        reportText += `|${key}|${val}|${pct}|${status}|${link?.link ?? ''}|\n`
      }
    } else {
      reportText += `\n### Licenses\n|License|Count|%|Info|\n|---|---|---|---|\n`
      for (const [key, val] of Object.entries(groups)) {
        const link = licenseMapping.find(m => m.license === key.toLowerCase())
        const pct = Math.round((val / packages.length) * 10000) / 100
        reportText += `|${key}|${val}|${pct}|${link?.link ?? ''}|\n`
      }
    }

    if (violations.length) {
      reportText += `\n### ⚠️ Violations (forbidden licenses)\n`
      violations.forEach(v => { reportText += `- ${v.package}: ${v.license}\n` })
    }
    if (warnings.length) {
      reportText += `\n### ⚡ Warnings (review required)\n`
      warnings.forEach(w => { reportText += `- ${w.package}: ${w.license}\n` })
    }
    if (expired.length) {
      reportText += `\n### 🕐 Expired overrides (review required)\n`
      expired.forEach(e => {
        reportText += `- ${e.package}: override by ${e.override.approvedBy} on ${e.override.approvedAt} has expired\n`
      })
    }

    console.log(reportText)
  }

  // Exit code 1 if forbidden licenses or expired overrides found
  if (violations.length > 0 || expired.length > 0) process.exit(1)
}

if (require.main === module) licenseCheck()

module.exports = { fetchLicense, classify, applyOverride, licenseCheck }
