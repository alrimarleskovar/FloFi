// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

it('ships the licensed Landing 07 display font payloads with exact digests, scoped to the landing route', async () => {
  const root = new URL('../../public/fonts/landing07/',import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json',root),'utf8')) as { files: {file:string;sha256:string;bytes:number}[];preload:string[] };
  expect(manifest.files).toHaveLength(3);
  for(const entry of manifest.files){
    const data = await readFile(new URL(entry.file,root));
    expect(data.subarray(0,4).toString()).toBe('wOF2');
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
    expect(data.length).toBe(entry.bytes);
  }
  for(const file of manifest.preload) expect(manifest.files.some(entry=>entry.file===file)).toBe(true);
  expect(await readFile(new URL('Anton.OFL.txt',root),'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  const css = await readFile(new URL('../app/landing07-fonts.css',import.meta.url),'utf8');
  for(const entry of manifest.files) expect(css).toContain(`url(/fonts/landing07/${entry.file})`);
  const route = await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  for(const file of manifest.preload) expect(route).toContain(`/fonts/landing07/${file}`);
  expect(await readFile(new URL('../app/fonts.css',import.meta.url),'utf8')).not.toContain('Anton');
});
