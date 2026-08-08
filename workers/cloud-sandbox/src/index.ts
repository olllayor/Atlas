import { SandboxDO } from './SandboxDO';

export interface Env {
  SANDBOX_DO: DurableObjectNamespace<SandboxDO>;
  CF_API_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/exec') {
      return new Response('Not Found', { status: 404 });
    }

    if (env.CF_API_SECRET) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.CF_API_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    const body = await request.json<{ command: string; conversationId?: string; env?: Record<string, string>; timeoutMs?: number }>();
    if (!body.command) {
      return new Response('Missing command parameter', { status: 400 });
    }

    // Scope each conversation to its own Durable Object instance so shell
    // state (cwd, env, running processes) is isolated between conversations.
    const sessionKey = body.conversationId ?? 'default-session';
    const id = env.SANDBOX_DO.idFromName(sessionKey);
    const stub = env.SANDBOX_DO.get(id);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendEvent = async (event: object) => {
      await writer.write(encoder.encode(JSON.stringify(event) + '\n'));
    };

    (async () => {
      try {
        await stub.execCommand(body.command, body.env ?? {}, body.timeoutMs ?? 30000, sendEvent);
      } catch (err: any) {
        await sendEvent({ type: 'error', error: err.message || String(err) });
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  },
};

export { SandboxDO };
