import { mkdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Fresh sessions share an empty working directory, never conversation history.
export async function providerWorkspace(home = homedir()) {
  const directory = path.join(home, 'Library', 'Application Support', 'Just Maple', 'Provider Workspace');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid provider workspace');
  return directory;
}
