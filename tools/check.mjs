import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'tests', 'tools']) {
  for (const name of await readdir(new URL(`../${dir}/`, import.meta.url))) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
console.log('All JavaScript syntax checks passed.');
