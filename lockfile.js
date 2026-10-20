const { promises: fs } = require('fs')

const readIfExists = async(file) => {
  try {
    return await fs.readFile(file, 'utf-8')
  }
  catch {
    return null
  }
}

// "name@^1.0.0" / name@npm:^1.0.0 -> { name, range }. Returns null for aliases, workspaces and anything else that is no registry package.
const splitSpecifier = (specifier) => {
  const clean = specifier.replace(/^"|"$/g, '')
  const at = clean.indexOf('@', 1)
  if (at === -1) return null
  const name = clean.slice(0, at)
  const range = clean.slice(at + 1).replace(/^npm:/, '')
  if (range.includes('@') || range.startsWith('workspace:')) return null
  return { name, range }
}

// yarn.lock v1 and berry. Returns [{ name, range, version }], one entry per requested range
const parseYarnLock = (text) => {
  const entries = []
  for (const block of text.split(/\n\s*\n/)) {
    const header = block.split('\n').find(l => l && !l.startsWith(' ') && !l.startsWith('#'))
    const version = block.match(/^ +version:? +"?([^"\s]+)"?/m)?.[1]
    if (!header?.endsWith(':') || !version) continue
    for (const specifier of header.slice(0, -1).split(/, ?/)) {
      const parsed = splitSpecifier(specifier)
      if (parsed) entries.push({ ...parsed, version })
    }
  }
  return entries
}

// package-lock.json v1 (nested "dependencies") and v2/v3 ("packages"). Returns [{ name, version, top }]
const parsePackageLock = (text) => {
  const lock = JSON.parse(text)
  const entries = []

  if (lock.packages) {
    for (const [key, value] of Object.entries(lock.packages)) {
      if (!key.includes('node_modules/') || !value.version || value.link) continue
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      entries.push({ name, version: value.version, top: key === `node_modules/${name}` })
    }
    return entries
  }

  const walk = (dependencies = {}, top) => {
    for (const [name, value] of Object.entries(dependencies)) {
      if (value.version && /^\d/.test(value.version)) entries.push({ name, version: value.version, top })
      walk(value.dependencies, false)
    }
  }
  walk(lock.dependencies, true)
  return entries
}

// Reads yarn.lock or package-lock.json of the given directory. Returns null when there is none (or it cannot be parsed)
const readLockfile = async(dir) => {
  try {
    const yarn = await readIfExists(`${dir}/yarn.lock`)
    if (yarn) return parseYarnLock(yarn)
    const npm = await readIfExists(`${dir}/package-lock.json`)
    if (npm) return parsePackageLock(npm)
  }
  catch {
    return null
  }
  return null
}

// Version of a direct dependency as pinned in the lockfile, undefined if it is not found
const resolveDirect = (entries, name, range) => {
  const entry = entries.find(e => e.name === name && ('top' in e ? e.top : e.range === range))
  return entry?.version
}

// All distinct name@version combinations of the lockfile
const allPackages = (entries) => {
  const seen = new Map(entries.map(e => [`${e.name}@${e.version}`, { name: e.name, version: e.version }]))
  return [...seen.values()]
}

module.exports = { readLockfile, resolveDirect, allPackages, parseYarnLock, parsePackageLock }
