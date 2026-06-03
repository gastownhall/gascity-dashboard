#!/usr/bin/env -S npx tsx
import { render } from 'ink';
import { App } from './App.tsx';
import { resolveConfig } from './config.ts';

// Alternate screen buffer (what vim/less/htop use): the app owns one clean
// screen, so frames never leak into the terminal's scrollback and "the top" is
// always the live top. Restored on exit so the prior terminal contents return.
const ALT_ENTER = '\x1b[?1049h';
const ALT_LEAVE = '\x1b[?1049l';

function main(): void {
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const useAlt = Boolean(process.stdout.isTTY);
  if (useAlt) process.stdout.write(ALT_ENTER);

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (useAlt) process.stdout.write(ALT_LEAVE);
  };

  const app = render(
    <App baseUrl={config.baseUrl} city={config.city} compact={config.compact} mouse={config.mouse} />,
  );
  app.waitUntilExit().then(restore, restore);
  // Belt-and-suspenders: leave the alt screen even on an abrupt exit so the
  // user's terminal is never left in the alternate buffer.
  process.on('exit', restore);
}

main();
