import { cp, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const sourceRoot = resolve(import.meta.dir, '..')
const argument = Bun.argv[2]
if (!argument) { throw new Error('Usage: bun run create -- <new-directory>') }
const destination = resolve(argument)
try {
  await lstat(destination)
  throw new Error('Target directory already exists')
}
catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error }
}
async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stderr: 'pipe', stdout: 'pipe' })
  const [output, error, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (status !== 0) { throw new Error(error || command.join(' ')) }
  return output
}
if (!await Bun.file(resolve(sourceRoot, '.gitmodules')).exists()) {
  throw new Error('Run create from a Yuumi template checkout with Git submodules.')
}
const templates = ['server', 'web'] as const
for (const name of templates) {
  const path = `packages/${name}`
  const repository = resolve(sourceRoot, path)
  const indexed = await run(['git', 'ls-files', '--stage', '--', path], sourceRoot)
  const fixedCommit = indexed.match(/^160000 ([0-9a-f]+) 0\t/)?.[1]
  const metadata = await lstat(resolve(repository, '.git')).catch((error) => {
    if (error.code !== 'ENOENT') { throw error }
  })
  if (!fixedCommit || !metadata || (await run(['git', 'rev-parse', 'HEAD'], repository)).trim() !== fixedCommit) {
    throw new Error(`Expected ${path} at the fixed template commit. Run git submodule update --init --recursive in the template checkout.`)
  }
}
await mkdir(dirname(destination), { recursive: true })
const stage = await mkdtemp(resolve(dirname(destination), '.yuumi-create-'))
async function copyTracked(repository: string, target: string) {
  const files = (await run(['git', 'ls-files', '-z'], repository)).split('\0').filter(Boolean)
  for (const file of files) {
    if (file === '.gitmodules' || file.split('/').some(part => ['.git', 'node_modules', 'dist', '.memory', '.migration'].includes(part))) { continue }
    const basename = file.split('/').at(-1)!
    if ((basename.startsWith('.env') && basename !== '.env.example' && !(repository.endsWith('/packages/web') && file === 'env/.env')) || basename.endsWith('.local')) { continue }
    const source = resolve(repository, file)
    const stat = await lstat(source)
    if (!stat.isFile()) { continue }
    await mkdir(dirname(resolve(target, file)), { recursive: true })
    await cp(source, resolve(target, file))
  }
}
try {
  await copyTracked(sourceRoot, stage)
  for (const name of templates) { await copyTracked(resolve(sourceRoot, 'packages', name), resolve(stage, 'packages', name)) }
  await run(['git', 'init', '-b', 'main'], stage)
  await mkdir(destination)
  await rename(stage, destination)
  console.info(`Created ${destination}. Run bun install and bun run setup there.`)
}
catch (error) { await rm(stage, { force: true, recursive: true }); throw error }
