# AdmiralCloud License Check

[![Tests](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/test.yml)
[![CodeQL](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/AdmiralCloud/ac-licensecheck/actions/workflows/github-code-scanning/codeql)

Reads the `package.json` of a given repository and determines licenses for all dependencies.

## How it works

1. Reads `dependencies` and `devDependencies` from the `package.json` of the target repository.
2. Fetches the license of each package from the npm registry (`npm info <package>`, latest published version).
3. Classifies each license against the license policy file (see below) as `allowed`, `warn`, `forbidden` or `unknown`.
4. Applies approved overrides from the policy file to findings that need a decision (`warn` or `unknown`).
5. Prints a markdown or JSON report. Exit code 1 if forbidden licenses or expired overrides are found.

The tool only evaluates the policy file it is given. Which licenses are allowed, how findings are reviewed and who approves overrides is described in the process documentation of the central scan: [ac-compliance/licenses](https://github.com/AdmiralCloud/ac-compliance/tree/main/licenses).

Combined licenses (SPDX expressions): `A OR B` (free choice) takes the mildest status, `A AND B` (all apply) takes the strictest. Malformed expressions are `unknown`.

## Limitations

- Only **direct** dependencies from `package.json` are checked, not transitive dependencies.
- The license is read from the **latest published version** on npm, not from the version pinned in the lockfile.
- `devDependencies` are included.
- Packages installed from private git URLs (`git+ssh`) cannot be looked up and get status `private`.
- Only license types are checked, not whether license notices are shipped with a product.

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

An override is the documented approval of a finding that needs a decision: a package with status `warn` (e.g. MPL-2.0) or `unknown` (license missing, `n/a`, custom or "SEE LICENSE IN …"). It is the only way to settle such a finding, and it always leaves a trace in the report.

- Applies to `warn` and `unknown` findings only. Packages that are already `allowed` need no override.
- **Forbidden licenses can never be approved** by an override. If the license in the override is itself forbidden, the package stays a violation.
- A package with an approved override gets status `allowed`. The report item keeps the original finding (`reportedLicense`) and the approval (`override` with reason, approver and date), so every exception can be traced.

Each override requires:
- `license` — the actual license of the package (checked by the approver, e.g. LICENSE file or repository)
- `reason` — why the package is acceptable (e.g. "unmodified use, test tooling only")
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
