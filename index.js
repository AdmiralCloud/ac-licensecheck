const { promises: fs } = require("fs")
const _ = require('lodash')
const axios = require('axios')

const licenseMapping = [
  { license: 'agpl-3.0', link: 'https://choosealicense.com/licenses/agpl-3.0/' },
  { license: 'gpl-3.0', link: 'https://choosealicense.com/licenses/gpl-3.0/' },
  { license: 'lgpl-3.0', link: 'https://choosealicense.com/licenses/lgpl-3.0/' },
  { license: 'mpl-2.0', link: 'https://choosealicense.com/licenses/mpl-2.0/' },
  { license: 'bsd-2-clause', link: 'https://choosealicense.com/licenses/bsd-2-clause/' },
  { license: 'apache-2.0', link: 'https://choosealicense.com/licenses/apache-2.0/' },
  { license: 'mit', link: 'https://choosealicense.com/licenses/mit/' },
  { license: 'wtfpl', link: 'https://choosealicense.com/licenses/wtfpl/' }
]

const licenseCheck = async () => {
  const package = process.argv[2] || '.'
  let pjson = await fs.readFile(`${package}/package.json`, 'utf-8')
  pjson = JSON.parse(pjson)
  const name = _.get(pjson, 'name')
  let packages = []
  _.forEach(_.merge(_.get(pjson, 'dependencies'), _.get(pjson, 'devDependencies')), (val, key) => {
    packages.push({
      package: key,
      version: val
    })
  })
  packages = _.orderBy(packages, 'package')
  
  let report = []
  for (let i = 0; i < packages.length; i++) {
    // https://api.npms.io/v2/package/ac-geoip
    let p = packages[i]
    // ignore private packages ()
    if (!_.startsWith(p.version, 'git+ssh')) {
      console.log('Collecting info: ', p.package)
      let response = await axios.get(`https://api.npms.io/v2/package/${encodeURIComponent(p.package)}`)
      let reportItem = {
        package: p.package,
        license: _.get(response, 'data.collected.metadata.license', 'n/a')
      }
      report.push(reportItem)  
    }
    else {
      let reportItem = {
        package: p.package,
        license: 'Private package'
      }
      report.push(reportItem)  
    }
  }

  let groups = _.countBy(report, 'license')
  let stats = {
    repository: name,
    date: new Date().toString(),
    total: _.size(packages),
    analyzed: _.size(report)
  }

  let reportText = `# AC License Report\n`
  reportText+= `|Stat|Value|\n|---|---|\n`    
  _.forEach(stats, (val, key) => {
    reportText+= `|${_.upperFirst(key)}|${val}|\n`
  })

  reportText+= `\n&nbsp;\n### Licenses\n|License|Count|Percent|Info|\n|---|---|---|---|\n`
  let details = `\n&nbsp;\n### Detailed Report\n|License|Packages|\n|---|---|\n`
  _.forEach(groups, (val, key) => {
    let license = _.find(licenseMapping, { license: _.toLower(key) })
    reportText+= `|${key}|${val}|${_.round((val/_.size(packages))*100,2)}|${_.get(license, 'link', '')}|\n`
    let p = _.filter(report, { license: key })
    details+= `|${key}|${_.join(_.map(p, item => { return item.package }), ', ') }|\n`
  })

  reportText += details

  console.log('')
  console.log('')
  console.log(reportText)
}

licenseCheck()