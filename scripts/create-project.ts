import { lstat, mkdir, mkdtemp, rename, rm, rmdir } from 'node:fs/promises'
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
const sourceCommit = (await run(['git', 'rev-parse', '--verify', 'HEAD'], sourceRoot).catch(() => '')).trim()
if (!sourceCommit || !(await run(['git', 'ls-tree', sourceCommit, '--', '.gitmodules'], sourceRoot)).trim()) {
  throw new Error('Run create from a Yuumi template checkout with Git submodules.')
}
const templates: { fixedCommit: string, name: 'server' | 'web', path: string, repository: string }[] = []
for (const name of ['server', 'web'] as const) {
  const path = `packages/${name}`
  const repository = resolve(sourceRoot, path)
  const entry = await run(['git', 'ls-tree', sourceCommit, '--', path], sourceRoot)
  const fixedCommit = entry.match(/^160000 commit ([0-9a-f]+)\t/)?.[1]
  const metadata = await lstat(resolve(repository, '.git')).catch((error) => {
    if (error.code !== 'ENOENT') { throw error }
  })
  if (!fixedCommit || !metadata || (await run(['git', 'rev-parse', 'HEAD'], repository)).trim() !== fixedCommit) {
    throw new Error(`Expected ${path} at the fixed template commit. Run git submodule update --init --recursive in the template checkout.`)
  }
  templates.push({ fixedCommit, name, path, repository })
}
if (!Bun.which('tar')) { throw new Error('Install tar before running create.') }

async function exportTracked(repository: string, commit: string, target: string, publicEnv?: string) {
  const tree = await run(['git', 'ls-tree', '-rz', commit], repository)
  const files = tree.split('\0')
    // 仅导出普通文件，保留原有的配置排除规则，并避免读取工作树或跟随链接。
    .filter(entry => /^100(?:644|755) blob /.test(entry))
    .map(entry => entry.slice(entry.indexOf('\t') + 1))
    .filter((file) => {
      const parts = file.split('/')
      const basename = parts[parts.length - 1]
      return file !== '.gitmodules'
        && !parts.some(part => ['.git', 'node_modules', 'dist', '.memory', '.migration'].includes(part))
        && !basename.endsWith('.local')
        && (!basename.startsWith('.env') || basename === '.env.example' || file === publicEnv)
    })
  if (!files.length) { return }
  await mkdir(target, { recursive: true })
  const archive = Bun.spawn(['git', '--literal-pathspecs', 'archive', commit, '--', ...files], {
    cwd: repository,
    stderr: 'inherit',
    stdout: 'pipe',
  })
  const extract = Bun.spawn(['tar', '-xf', '-', '-C', target], { stderr: 'inherit', stdin: archive.stdout })
  const statuses = await Promise.all([archive.exited, extract.exited])
  if (statuses.some(status => status !== 0)) {
    throw new Error(`Unable to export committed files from ${repository} at ${commit}`)
  }
}

await mkdir(dirname(destination), { recursive: true })
const stage = await mkdtemp(resolve(dirname(destination), '.yuumi-create-'))
try {
  await exportTracked(sourceRoot, sourceCommit, stage)
  for (const { fixedCommit, name, path, repository } of templates) {
    await exportTracked(repository, fixedCommit, resolve(stage, path), name === 'web' ? 'env/.env' : undefined)
  }
  await run(['git', 'init', '-b', 'main'], stage)
  await mkdir(destination)
  try { await rename(stage, destination) }
  catch (error) {
    await rmdir(destination).catch(() => undefined)
    throw error
  }
  console.info(`Created ${destination}. Run bun install --frozen-lockfile and bun run setup there.`)
}
finally { await rm(stage, { force: true, recursive: true }) }
