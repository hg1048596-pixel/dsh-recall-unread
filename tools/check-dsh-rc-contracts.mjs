import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read-only, offline source verification. The exported sources are deliberately
// kept outside this plugin repository; alternatively supply an upstream checkout.
const args = process.argv.slice(2)
if (args.length !== 2 || !['--source-dir', '--git-dir'].includes(args[0])) {
  console.error('Usage: node tools/check-dsh-rc-contracts.mjs --source-dir <tag-directory-root>')
  console.error('   or: node tools/check-dsh-rc-contracts.mjs --git-dir <upstream-checkout>')
  process.exit(1)
}

const root = resolve(args[1])
const fixture = JSON.parse(readFileSync(new URL('./fixtures/dsh-rc-contracts.json', import.meta.url), 'utf8'))
assert.equal(fixture.schemaVersion, 1)
assert.equal(fixture.releases.length, 5)
assert.deepEqual(fixture.releases.map(release => release.tag), [1, 2, 3, 4, 5].map(rc => `dsh-v0.2.1-rc.${rc}`))
const git = (...gitArgs) => execFileSync('git', ['-C', root, ...gitArgs], {
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  maxBuffer: 8 * 1024 * 1024,
})

let fileCount = 0
let contractCount = 0
for (const release of fixture.releases) {
  if (args[0] === '--git-dir') {
    assert.equal(git('rev-parse', `${release.tag}^{commit}`).toString('utf8').trim(), release.commit, `${release.tag}: tag commit changed`)
  }
  const sources = new Map()
  for (const [path, expectedHash] of Object.entries(release.files)) {
    const bytes = args[0] === '--source-dir'
      ? readFileSync(resolve(root, release.tag, path))
      : git('show', `${release.commit}:${path}`)
    const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    assert.equal(hash, expectedHash, `${release.tag}:${path}: upstream bytes differ`)
    sources.set(path, bytes.toString('utf8'))
    fileCount += 1
  }
  for (const contract of fixture.contracts) {
    let source = sources.get(contract.path)
    assert.ok(source !== undefined, `${contract.id}: source is absent from manifest`)
    if (contract.section) {
      const start = source.indexOf(contract.section.start)
      const end = source.indexOf(contract.section.end, start + contract.section.start.length)
      assert.ok(start !== -1 && end > start, `${release.tag}:${contract.id}: section is absent`)
      source = source.slice(start, end)
    }
    for (const needle of contract.needles) {
      assert.ok(source.includes(needle), `${release.tag}:${contract.id}: contract excerpt is absent: ${needle}`)
    }
    contractCount += 1
  }
  console.log(`${release.tag} (${release.commit.slice(0, 7)}): ${Object.keys(release.files).length} source hashes and ${fixture.contracts.length} contracts verified`)
}
console.log(`PASS: ${fileCount} source hashes and ${contractCount} source contracts; no network or GUI runtime was used.`)
