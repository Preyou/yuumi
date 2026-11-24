import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

function run(cwd: string, ...command: string[]) {
  const result = Bun.spawnSync(command, { cwd, stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) { throw new Error(result.stderr.toString() || command.join(' ')) }
  return result.stdout.toString().trim()
}

function commit(cwd: string) {
  run(cwd, 'git', '-c', 'user.name=Yuumi Test', '-c', 'user.email=yuumi@example.test', 'commit', '-m', 'Test fixture')
  return run(cwd, 'git', 'rev-parse', 'HEAD')
}

test('create exports fixed commits and public settings survive a Git clone', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'yuumi-create-test-'))
  try {
    const template = resolve(directory, 'template')
    const generated = resolve(directory, 'generated')
    const cloned = resolve(directory, 'cloned')
    await mkdir(resolve(template, 'scripts'), { recursive: true })
    await cp(resolve(import.meta.dir, 'create-project.ts'), resolve(template, 'scripts/create-project.ts'))
    await cp(resolve(import.meta.dir, '../.gitignore'), resolve(template, '.gitignore'))
    await Bun.write(resolve(template, '.gitmodules'), '')
    await Bun.write(resolve(template, 'README.md'), 'committed template')
    run(template, 'git', 'init')
    run(template, 'git', 'add', '.gitignore', '.gitmodules', 'README.md', 'scripts')

    let serverCommit = ''
    for (const name of ['server', 'web']) {
      const repository = resolve(template, 'packages', name)
      await mkdir(repository, { recursive: true })
      run(repository, 'git', 'init')
      await Bun.write(resolve(repository, 'example.txt'), 'committed source')
      await Bun.write(resolve(repository, 'bun.lock'), '{}')
      if (name === 'web') { await Bun.write(resolve(repository, 'env/.env'), 'APP_NAME=Example') }
      await Bun.write(resolve(repository, '.env.local'), 'fixture only')
      run(repository, 'git', 'add', '-f', '.')
      const fixedCommit = commit(repository)
      run(template, 'git', 'update-index', '--add', '--cacheinfo', `160000,${fixedCommit},packages/${name}`)
      if (name === 'server') { serverCommit = fixedCommit }
    }
    commit(template)

    await Bun.write(resolve(template, 'README.md'), 'staged change')
    run(template, 'git', 'add', 'README.md')
    run(template, 'git', 'update-index', '--cacheinfo', `160000,${serverCommit},packages/web`)
    await Bun.write(resolve(template, 'packages/web/example.txt'), 'uncommitted change')

    run(template, 'bun', 'scripts/create-project.ts', generated)
    expect(await Bun.file(resolve(generated, 'README.md')).text()).toBe('committed template')
    expect(await Bun.file(resolve(generated, 'packages/web/example.txt')).text()).toBe('committed source')
    expect(await Bun.file(resolve(generated, 'packages/server/.env.local')).exists()).toBe(false)
    expect(await Bun.file(resolve(generated, '.gitmodules')).exists()).toBe(false)

    run(generated, 'git', 'add', '.')
    commit(generated)
    run(directory, 'git', 'clone', generated, cloned)
    expect(await Bun.file(resolve(cloned, 'packages/web/env/.env')).text()).toBe('APP_NAME=Example')
    expect(await Bun.file(resolve(cloned, 'packages/web/bun.lock')).exists()).toBe(true)
  }
  finally { await rm(directory, { force: true, recursive: true }) }
})
