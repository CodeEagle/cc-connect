import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Play, PlugZap, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import api from '@/api/client';
import { cn } from '@/lib/utils';

const loginCommands = [
  { label: 'Claude Code', command: 'claude login' },
  { label: 'Codex', command: 'codex login' },
  { label: 'Gemini', command: 'gemini' },
  { label: 'iFlow', command: 'iflow login' },
  { label: 'OpenCode', command: 'opencode auth login' },
  { label: 'Kimi', command: 'kimi login' },
  { label: 'Qoder', command: 'qodercli login' },
];

function terminalUrl(cols: number, rows: number) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    cols: String(cols),
    rows: String(rows),
  });
  const token = api.getToken();
  if (token) params.set('token', token);
  return `${protocol}//${window.location.host}/api/v1/terminal/ws?${params.toString()}`;
}

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');

  const resizeTerminal = useCallback(() => {
    const term = termRef.current;
    const container = containerRef.current;
    if (!term || !container) return { cols: 120, rows: 32 };

    const rect = container.getBoundingClientRect();
    const cols = Math.max(40, Math.floor(rect.width / 9));
    const rows = Math.max(12, Math.floor(rect.height / 18));
    term.resize(cols, rows);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
    return { cols, rows };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setStatus('Disconnected');
  }, []);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    disconnect();
    term.clear();
    const size = resizeTerminal();
    const ws = new WebSocket(terminalUrl(size.cols, size.rows));
    wsRef.current = ws;
    setStatus('Connecting...');

    ws.onopen = () => {
      setConnected(true);
      setStatus('Connected');
      term.focus();
    };
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'output') term.write(payload.data || '');
        if (payload.type === 'error') term.writeln(`\r\n[terminal error] ${payload.data || 'unknown error'}`);
      } catch {
        term.write(String(event.data));
      }
    };
    ws.onclose = () => {
      setConnected(false);
      setStatus('Disconnected');
    };
    ws.onerror = () => {
      setConnected(false);
      setStatus('Connection error');
    };
  }, [disconnect, resizeTerminal]);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: '#05070a',
        foreground: '#d8dee9',
        cursor: '#42ff9c',
        selectionBackground: '#284b3c',
      },
    });
    termRef.current = term;
    if (containerRef.current) term.open(containerRef.current);

    const dataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => resizeTerminal());
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    connect();

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [connect, resizeTerminal]);

  const sendCommand = (command: string) => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || ws?.readyState !== WebSocket.OPEN) return;
    const text = `${command}\r`;
    ws.send(JSON.stringify({ type: 'input', data: text }));
    term.focus();
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-gray-50 dark:bg-black">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b',
          'border-gray-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-black/80',
        )}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-950 dark:text-white">Terminal</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Full shell inside the cc-connect container · {status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={connect}>
            <PlugZap size={14} />
            Connect
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => termRef.current?.clear()}>
            <Trash2 size={14} />
            Clear
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={disconnect}>
            <RotateCcw size={14} />
            Disconnect
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-gray-200/80 dark:border-white/[0.08] bg-white/65 dark:bg-black/70">
        {loginCommands.map((item) => (
          <Button
            key={item.label}
            type="button"
            variant={connected ? 'secondary' : 'ghost'}
            size="sm"
            disabled={!connected}
            onClick={() => sendCommand(item.command)}
          >
            <Play size={13} />
            {item.label}
          </Button>
        ))}
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div
          ref={containerRef}
          className={cn(
            'h-full w-full overflow-hidden rounded-lg border p-2',
            'bg-[#05070a] border-gray-200/80 dark:border-white/[0.08]',
          )}
        />
      </div>
    </div>
  );
}
