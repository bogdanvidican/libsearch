// A download job (books or encyclopedias) running as a child process of the server, like the index build:
// downloads never block the server, and stopping the app just stops them (they continue next time).
import { ChildProcess, fork } from 'child_process';
import { DownloadProgress } from '../shared/api';
import { idleProgress } from '../downloader/books';

export interface JobMessage {
  type?: string;
  progress?: DownloadProgress;
  file?: string;
}

export class DownloadJob {
  private child: ChildProcess | null = null;
  private p: DownloadProgress = idleProgress();
  private stderr = '';

  constructor(
    private readonly script: string,
    readonly name: 'books' | 'zims',
    private readonly hooks: { onMessage?: (m: JobMessage) => void; onExit?: (p: DownloadProgress) => void } = {}
  ) {}

  running(): boolean {
    return !!this.child;
  }

  /** Running until the process has exited - its last report comes a moment before it is gone. */
  progress(): DownloadProgress {
    return Object.assign({}, this.p, { running: this.p.running || !!this.child });
  }

  start(args: string[]): DownloadProgress {
    if (this.child) return this.progress();
    this.stderr = '';
    this.p = Object.assign(idleProgress(), { running: true, phase: 'checking' as const, startedAt: Date.now() });
    const child = fork(this.script, ['--job', this.name].concat(args), {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    child.stderr!.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    child.on('message', (m: JobMessage) => {
      if (m && m.type === 'progress' && m.progress) this.p = m.progress;
      if (this.hooks.onMessage) this.hooks.onMessage(m);
    });
    child.on('error', (e) => {
      this.stderr += `\n${e.message}`;
    });
    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.p.running) {
        // It ended without saying so (crash, killed): report it plainly.
        const tail = this.stderr.trim().split('\n').slice(-1)[0] || '';
        this.p = Object.assign({}, this.p, {
          running: false,
          phase: code === 3 ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          notice:
            code === 3
              ? undefined
              : { kind: 'error', code: 'downloads-stopped', message: tail || `The download stopped unexpectedly (${signal || 'exit ' + code}).`, fix: 'Try again: it continues where it stopped.' },
        });
      }
      if (this.hooks.onExit) this.hooks.onExit(this.progress());
    });
    return this.progress();
  }

  cancel(): DownloadProgress {
    if (this.child) this.child.kill('SIGTERM');
    return this.progress();
  }

  stop(): void {
    if (!this.child) return;
    try {
      this.child.kill('SIGTERM');
    } catch (e) {
      // already gone
    }
  }
}
