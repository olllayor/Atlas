import { SandboxDO } from './SandboxDO';

export interface Env {
  SANDBOX_DO: DurableObjectNamespace<SandboxDO>;
  CF_API_SECRET?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Auth check for non-OPTIONS requests if secret configured
    if (env.CF_API_SECRET) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.CF_API_SECRET}`) {
        return textResponse('Unauthorized', 401);
      }
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        version: '0.1.0',
        timestamp: Date.now(),
        durableObjectsAvailable: Boolean(env.SANDBOX_DO),
      });
    }

    if (request.method !== 'POST') {
      return textResponse('Method Not Allowed', 405);
    }

    // Reset session endpoint
    if (url.pathname === '/reset') {
      const body = (await request.json<{ conversationId?: string }>().catch(() => ({}))) as { conversationId?: string };
      const sessionKey = body.conversationId ?? 'default-session';
      const id = env.SANDBOX_DO.idFromName(sessionKey);
      const stub = env.SANDBOX_DO.get(id);
      const result = await stub.resetSession();
      return jsonResponse({ status: 'ok', reset: result.ok });
    }

    // Command execution endpoint
    if (url.pathname === '/exec') {
      const body = await request.json<{ command: string; conversationId?: string; env?: Record<string, string>; timeoutMs?: number }>();
      if (!body.command) {
        return textResponse('Missing command parameter', 400);
      }

      const sessionKey = body.conversationId ?? 'default-session';
      const id = env.SANDBOX_DO.idFromName(sessionKey);
      const stub = env.SANDBOX_DO.get(id);

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      /**
       * Signal-driven shutdown: the request aborts when the client disconnects,
       * which is the only truthful signal in a Workers fetch handler. Writes
       * race the signal; once it fires the loop exits promptly instead of
       * writing NDJSON into a sink nobody reads. The signal is forward to the
       * DO so it can cancel the exec iterator too.
       */
      const signal = request.signal;

      const sendEvent = async (event: object): Promise<boolean> => {
        if (signal.aborted) return false;
        try {
          await Promise.race([
            writer.write(encoder.encode(JSON.stringify(event) + '\n')),
            new Promise<void>((resolve) => {
              if (signal.aborted) return resolve();
              signal.addEventListener('abort', () => resolve(), { once: true });
            }),
          ]);
          return !signal.aborted;
        } catch {
          return false;
        }
      };

      (async () => {
        try {
          // The DO returns once the exit event lands (or the iterator is
          // cancelled); sendEvent swallows aborts internally so the loop just
          // stops emitting after the client is gone.
          await stub.execCommand(
            body.command,
            body.env ?? {},
            body.timeoutMs ?? 30000,
            async (evt) => { await sendEvent(evt); },
            signal
          );
        } catch (err: any) {
          if (!signal.aborted) {
            await sendEvent({ type: 'error', error: err.message || String(err) });
          }
        } finally {
          // close() after abort is a no-op under undici semantics; still call
          // it so the readable side terminates cleanly either way.
          await writer.close().catch(() => undefined);
        }
      })();

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...CORS_HEADERS,
        },
      });
    }

    return textResponse('Not Found', 404);
  },
};

export { SandboxDO };
