import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
async function run(command: string[], cwd = root) {
  const child = Bun.spawn(command, { cwd, stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' })
  if (await child.exited !== 0) { throw new Error(`Setup failed in ${cwd}: ${command.join(' ')}`) }
}
// 展开后的业务项目没有 gitlink；不对普通源码目录执行 submodule 操作。
if (await Bun.file(resolve(root, '.gitmodules')).exists()) {
  await run(['git', 'submodule', 'sync', '--recursive'])
  await run(['git', 'submodule', 'update', '--init', '--recursive'])
}
for (const name of ['server', 'web']) { await run(['bun', 'install', '--frozen-lockfile'], resolve(root, 'packages', name)) }
const configuration = resolve(root, 'packages/server/.env.local')
if (!await Bun.file(configuration).exists()) { await Bun.write(configuration, Bun.file(resolve(root, 'packages/server/.env.example'))) }
console.info('Installed both templates. Configure packages/server/.env.local, start infrastructure, migrate, then run dev.')
