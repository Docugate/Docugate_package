import { spawn } from 'node:child_process'

/**
 * A live "working on it" line for the waits in setup: a spinner, the elapsed
 * time, and a status that changes every few seconds, so a minute of IBM Bob
 * reading the code never looks like a frozen terminal.
 *
 * It runs in a small child process, so it keeps moving even while the main
 * process is blocked waiting on Bob Shell. Only in a terminal; elsewhere it
 * prints the first status once.
 */
export function startSpinner(statuses: string[]): (finalLine?: string) => void {
  if (!process.stderr.isTTY || process.env.CI) {
    process.stderr.write(`  ${statuses[0]}...\n`)
    return (finalLine) => {
      if (finalLine) process.stderr.write(`${finalLine}\n`)
    }
  }
  const script = `
    const statuses = JSON.parse(process.argv[1]);
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    const start = Date.now();
    let i = 0;
    const cols = () => process.stderr.columns || 80;
    setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      const status = statuses[Math.min(Math.floor(secs / 6), statuses.length - 1)];
      const line = '  ' + frames[i++ % frames.length] + ' ' + status + '... ' + secs + 's';
      process.stderr.write('\\r' + line.slice(0, cols() - 1).padEnd(cols() - 1));
    }, 90);
  `
  const child = spawn(process.execPath, ['-e', script, JSON.stringify(statuses)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return (finalLine) => {
    child.kill()
    const width = process.stderr.columns || 80
    process.stderr.write(`\r${' '.repeat(width - 1)}\r`)
    if (finalLine) process.stderr.write(`${finalLine}\n`)
  }
}

/** Environment variables that look like an IBM Bob key under another name. */
export function bobKeyCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((name) => name !== 'BOB_API_KEY' && env[name])
    .filter((name) => /BOB|IBM|WATSONX/i.test(name) && /KEY|TOKEN|SECRET/i.test(name))
    .sort()
}
