# AdmiralCloud License Check
Reads the package.json of a given repository and tries to determine licenses for the dependencies.

# Usage
Install it globally or anywhere you want and the call it with the first CLI parameter being the path to the repository you want to analyze.

The response is a markup text you can copy and add to your README (see example below)

# Example
### AC License Report
|Stat|Value|
|---|---|
|Repository|ac-licensecheck|
|Date|Sun Dec 20 2020 14:04:03 GMT+0100 (GMT+01:00)|
|Total|2|
|Analyzed|2|

&nbsp;
### Licenses
|License|Count|Percent|Info|
|---|---|---|---|
|MIT|2|100|https://choosealicense.com/licenses/mit/|

&nbsp;
### Detailed Report
|License|Packages|
|---|---|
|MIT|axios, lodash|
