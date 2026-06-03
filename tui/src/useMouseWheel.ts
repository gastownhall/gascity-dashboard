import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';

// Enable/disable SGR mouse reporting. 1000 = button events (includes wheel),
// 1006 = SGR extended coordinates (so we get a clean `ESC [ < b ; x ; y M`
// frame instead of the legacy byte-packed form). We deliberately do NOT enable
// motion tracking (1003) — only discrete wheel ticks are wanted, and motion
// would flood stdin and fight terminal text selection.
const ENABLE = '\x1b[?1000h\x1b[?1006h';
const DISABLE = '\x1b[?1000l\x1b[?1006l';

// SGR wheel buttons: 64 = wheel up, 65 = wheel down.
const SGR_MOUSE = /\x1b\[<(\d+);\d+;\d+[Mm]/g;

/**
 * Calls `onWheel(-1)` on wheel-up and `onWheel(1)` on wheel-down. No-op when
 * the terminal can't do raw mode (piped output) — keyboard nav still works.
 *
 * `enabled` gates the mouse grab: when false, the TUI never enables mouse
 * reporting, so tmux keeps the mouse (drag-resize, click-to-focus, native
 * scrollback). Used by the pinned-beside-the-mayor launch (`--no-mouse`), where
 * a drag-resizable panel beats wheel scrolling. Keyboard nav is unaffected
 * either way (Ink owns raw mode for keypresses).
 */
export function useMouseWheel(onWheel: (direction: -1 | 1) => void, enabled = true): void {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();

  useEffect(() => {
    if (!enabled || !isRawModeSupported || !stdin) return;
    setRawMode(true);
    stdout.write(ENABLE);

    const onData = (chunk: Buffer | string): void => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      SGR_MOUSE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SGR_MOUSE.exec(s)) !== null) {
        const button = Number.parseInt(match[1] ?? '', 10);
        if (button === 64) onWheel(-1);
        else if (button === 65) onWheel(1);
      }
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      stdout.write(DISABLE);
    };
    // onWheel is captured fresh each render via the dependency.
  }, [stdin, stdout, setRawMode, isRawModeSupported, onWheel, enabled]);
}
