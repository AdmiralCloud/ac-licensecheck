# AdmiralCloud License Check

[![Tests](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml)
[![CodeQL](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/codeql.yml/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/codeql.yml)

Reads the `package.json` of a given repository and determines licenses for all dependencies.

## Usage

```
node index.js [path] [--json] [--config=<policy.json>]
```

| Argument | Description |
|---|---|
| `path` | Path to the repository to analyze (default: `.`) |
| `--json` | Output machine-readable JSON instead of markdown |
| `--config=<path>` | Path to a JSON license policy file |

## Output

### Default (markdown)
Prints a markdown report to stdout. Suitable for copy-pasting into a README.

```
node index.js ../ac-sanitizer
```

### JSON mode
Outputs a structured JSON object for CI/CD or centralized collection.

```
node index.js ../ac-sanitizer--json --config=policy.json
```

```json
{
  "repository": "ac-sanitizer",
  "date": "2026-05-03T10:00:00.000Z",
  "total": 42,
  "analyzed": 42,
  "violations": [],
  "warnings": [],
  "unknowns": [],
  "report": [{ "package": "lodash", "license": "MIT", "status": "allowed" }]
}
```

## License policy file

```json
{
  "allowed": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"],
  "warn": ["LGPL-3.0", "MPL-2.0"],
  "forbidden": ["GPL-3.0", "AGPL-3.0"]
}
```

Each package in the report gets a `status` field: `allowed`, `warn`, `forbidden`, `private`, or `unknown`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No forbidden licenses found |
| `1` | One or more forbidden licenses detected |

Exit code 1 allows CI/CD pipelines to fail on license violations.
