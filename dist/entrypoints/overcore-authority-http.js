import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OvercoreAuthorityAdapter, evaluateOvercoreAuthorizationRequest } from '../adapters/overcore/authorization.js';
import { AuthorityService } from '../application/evaluate-authority.js';
import { NodeDocumentFingerprinter } from '../adapters/node/node-document-fingerprinter.js';
const MAX_BODY_BYTES = 1_048_576;
function authorized(header, token) {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(header ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function bodyOf(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('Pedido excede o limite de 1 MiB.');
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
}
export function createOvercoreAuthorityServer(options) {
    if (typeof options.token !== 'string' || options.token.length < 16) {
        throw new Error('Token local de autoridade é curto demais.');
    }
    const evaluator = new AuthorityService({ now: options.at ?? (() => new Date()) });
    const adapter = new OvercoreAuthorityAdapter(evaluator, new NodeDocumentFingerprinter());
    return createServer(async (request, response) => {
        try {
            if (!authorized(request.headers.authorization, options.token)) {
                send(response, 401, { error: 'unauthorized' });
                return;
            }
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/health') {
                send(response, 200, { status: 'ready' });
                return;
            }
            if (request.method !== 'POST' || ![
                '/v1/authority/evaluate',
                '/v1/authority/revalidate-effect'
            ].includes(url.pathname)) {
                send(response, 404, { error: 'not-found' });
                return;
            }
            const body = await bodyOf(request);
            const result = url.pathname === '/v1/authority/evaluate'
                ? adapter.evaluate(body)
                : adapter.revalidateEffect(body);
            send(response, 200, result);
        }
        catch (error) {
            send(response, 400, {
                error: 'invalid-authority-request',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });
}
export const criarServidorAutoridadeOvercore = createOvercoreAuthorityServer;
export { evaluateOvercoreAuthorizationRequest, evaluateOvercoreAuthorizationRequest as avaliarPedidoOvercore };
export async function startOvercoreAuthorityCli() {
    const token = process.env.OMNI_AUTHORITY_PROVIDER_TOKEN;
    if (!token)
        throw new Error('OMNI_AUTHORITY_PROVIDER_TOKEN não foi definido.');
    const host = '127.0.0.1';
    const port = Number(process.env.OMNI_AUTHORITY_PROVIDER_PORT ?? '47832');
    if (!Number.isInteger(port) || port < 0 || port > 65_535)
        throw new Error('Porta local inválida.');
    const server = createOvercoreAuthorityServer({ token });
    await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Servidor não informou porta TCP.');
    process.stdout.write(`${JSON.stringify({ status: 'ready', url: `http://${host}:${address.port}/v1/authority/evaluate` })}\n`);
    const close = () => {
        server.close(() => process.exit(0));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    await startOvercoreAuthorityCli().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
