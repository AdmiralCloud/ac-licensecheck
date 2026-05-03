# AdmiralCloud License Check

[![Tests](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml)
[![CodeQL](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/github-code-scanning/codeql)

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
node index.js ../ac-sanitizer --json --config=policy.json
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
  "expired": [],
  "report": [{ "package": "lodash", "license": "MIT", "status": "allowed" }]
}
```

## License policy file

```json
{
  "allowed": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"],
  "warn": ["LGPL-3.0", "MPL-2.0"],
  "forbidden": ["GPL-3.0", "AGPL-3.0"],
  "overrides": {
    "html5shiv": {
      "license": "MIT",
      "reason": "No license field on npm, MIT confirmed on GitHub",
      "approvedBy": "MP",
      "approvedAt": "2026-05-03"
    }
  }
}
```

Each package in the report gets a `status` field: `allowed`, `warn`, `forbidden`, `private`, `unknown`, or `override-expired`.

### License matching

Matching is case-insensitive. The policy entry acts as the anchor: a reported license matches if it starts with the policy entry.

| Policy entry | Reported license | Match |
|---|---|---|
| `Apache-2.0` | `Apache-2.0-only` | ✓ |
| `GPL-3.0` | `GPL-3.0-only` | ✓ |
| `Apache` | `Apache-2.0` | ✓ (policy is intentionally broad) |
| `Apache-2.0` | `Apache` | ✗ (too vague → use an override) |
| `Apache-2.0` | `Apache-3.0` | ✗ (different version) |

### Overrides

Overrides allow you to manually classify packages whose license cannot be auto-detected (e.g. no `license` field on npm). They are **only applied when auto-detection fails** — if npm returns a license, the override is ignored.

Each override requires:
- `license` — the actual license of the package
- `approvedBy` — who approved the override
- `approvedAt` — ISO date (YYYY-MM-DD) when it was approved

Overrides expire after **1 year**. Expired overrides appear as `override-expired` in the report and trigger exit code 1, prompting a re-review.

## Test coverage

Requires [c8](https://github.com/bcoe/c8) installed globally (`npm install -g c8`).

```bash
c8 yarn test
c8 report --reporter=text
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No issues found |
| `1` | Forbidden licenses or expired overrides detected |

Exit code 1 allows CI/CD pipelines to fail on license violations.
