// The QA app's Vite plugins and config helpers. Node-side: the page never
// imports this file.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes one report under `resultsDir` as `<name>-<epoch ms>.json`. The body
 * goes to a `.tmp` file first and is renamed into place, so a reader polling
 * the directory never sees half a file.
 *
 * @param resultsDir - The results directory; created when missing.
 * @param name - The report's `name=`; characters outside `[\w.-]` become `_`.
 * @param body - The request body.
 */
function writeReport(resultsDir: string, name: string | null, body: Buffer): void {
    fs.mkdirSync(resultsDir, { recursive: true });

    const safeName = (name ?? 'unnamed').replace(/[^\w.-]/g, '_');
    const file = path.join(resultsDir, `${safeName}-${Date.now()}.json`);

    fs.writeFileSync(`${file}.tmp`, body);
    fs.renameSync(`${file}.tmp`, file);
}

/**
 * Accepts `POST /__qa/report?name=<name>` and writes the body to
 * `<resultsDir>/<name>-<epoch ms>.json`, through a `.tmp` file and a rename.
 * Every other request goes to the next middleware.
 *
 * @param options - `resultsDir`, where reports are written.
 * @returns The plugin.
 */
export function qaReportPlugin(options: { resultsDir: string }): Plugin {
    return {
        name: 'qa-report',
        configureServer(server): void {
            server.middlewares.use((req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://localhost');

                if (url.pathname !== '/__qa/report' || req.method !== 'POST') {
                    next();

                    return;
                }

                const chunks: Buffer[] = [];

                req.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                req.on('end', () => {
                    writeReport(options.resultsDir, url.searchParams.get('name'), Buffer.concat(chunks));
                    res.end('ok');
                });
            });
        },
    };
}

/**
 * Whether `file` is `dir` itself or inside it.
 *
 * @param file - An absolute path.
 * @param dir - An absolute path.
 * @returns `true` when `file` is `dir` or under it.
 */
function isUnder(file: string, dir: string): boolean {
    return file === dir || file.startsWith(dir + path.sep);
}

/**
 * A `server.watch.ignored` matcher that ignores every path except `root`
 * itself, `<root>/index.html`, `<root>/src/**` and `<root>/tests/**`. The
 * watcher asks about the root first and skips an ignored directory's
 * contents, so run output under the root is never walked.
 *
 * @param root - The app's root directory.
 * @returns `true` for a path the watcher should ignore.
 */
export function outsideAppSource(root: string): (file: string) => boolean {
    const watched = ['index.html', 'src', 'tests'].map((entry) => path.join(root, entry));

    return (file: string): boolean => file !== root && !watched.some((dir) => isUnder(file, dir));
}
