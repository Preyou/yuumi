import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dir, '..')
const task = Bun.argv[2]
const children: ReturnType<typeof Bun.spawn>[] = []
function stop() {
  for (const child of children) { child.kill() }
}
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})
process.on('SIGTERM', () => {
  stop()
  process.exit(143)
})
async function run(name: string, command: string[]) {
  const child = Bun.spawn(command, { cwd: resolve(root, 'packages', name), stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' })
  children.push(child)
  const status = await child.exited
  if (status !== 0) { throw new Error(`${name}: ${command.join(' ')} failed (${status})`) }
}
try {
  if (task === 'dev' || task === 'start') {
    const command = ['bun', '--no-orphans', 'run', task]
    await Promise.race([run('server', command), run('web', command)])
  }
  else if (task === 'generate') {
    await run('server', ['bun', 'run', 'openapi:export', '--', resolve(root, 'packages/web/src/api/openapi.json')])
    await run('web', ['bun', 'run', 'generate'])
  }
  else if (task === 'check') {
    await run('server', ['bun', 'run', 'check'])
    await run('web', ['bun', 'run', 'check'])
  }
  else if (task === 'build') { await run('web', ['bun', 'run', 'build']) }
  else { throw new Error('Expected dev, start, generate, check or build') }
}
finally { stop() }
