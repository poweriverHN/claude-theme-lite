/**
 * claude-theme-lite — a host-only re-hosting of the Claude CSS skin.
 *
 * Why this exists: the dsh-claude-style plugin delivers Claude's look, but it
 * ships ~1 MB of client JavaScript, injects 1,663 CSS rules, and runs 27
 * MutationObservers. On this machine that made scrolling visibly sluggish.
 * The pure-CSS Claude skin in $DSH_HOME/skins/claude carries the same palette
 * and typography in ~50 rules and zero script, but it could only be loaded by
 * @linxin666/dsh-client-ui-skin-center, which was uninstalled with dsh-web-all.
 *
 * This plugin re-hosts those two stylesheets through the host's own webserver:
 * one <link> pair injected into index.html by tapIndex, and four font files
 * served from the same path prefix. No client-side JavaScript is emitted at
 * all — the browser loads CSS and fonts and nothing else.
 *
 * The stylesheets are copied into this package rather than read from
 * $DSH_HOME/skins/claude so the theme cannot break when the skin center
 * rewrites or removes that directory.
 *
 * @module claude-theme-lite
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Public path prefix; every asset this plugin serves lives below it. */
const ROUTE_PREFIX = '/claude-lite'

/** Stylesheet files in application order: tokens first, then element patches. */
const STYLESHEETS = [
  { file: 'claude.css', url: `${ROUTE_PREFIX}/claude.css` },
  { file: 'claude-patches.css', url: `${ROUTE_PREFIX}/claude-patches.css` },
]

/** Font files the stylesheets reference through `url(assets/fonts/<name>)`. */
const FONTS = [
  'newsreader-normal.woff2',
  'newsreader-italic.woff2',
  'inter-normal.woff2',
  'jetbrains-mono-normal.woff2',
]

/** Directory holding the copied stylesheets and the assets/ tree. */
const LIB_DIR = dirname(fileURLToPath(import.meta.url))

/** Read one asset once at mount; a missing file is a mount-time error. */
function readAsset(...segments) {
  return readFileSync(join(LIB_DIR, ...segments))
}

/**
 * Answer one GET/HEAD with a fixed body.
 * @param request - the inbound request.
 * @param response - the outbound response.
 * @param contentType - the `content-type` header value.
 * @param cacheControl - the `cache-control` header value.
 * @param body - bytes to send; HEAD sends the headers only.
 */
function sendAsset(request, response, contentType, cacheControl, body) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(body)
}

/**
 * Mount the asset routes once the Web carrier exists, and remove them with the
 * fiber. The two <link> tags are injected into every index.html the host
 * renders; a stable `data-claude-lite` marker keeps a hot reload from doubling
 * them.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    // Stylesheets are re-read per request so tuning the theme is a browser
    // refresh, not a host restart. Fonts stay in memory: they never change and
    // are served immutable.
    const fonts = FONTS.map(name => ({ name, body: readAsset('assets', 'fonts', name) }))

    host.effect(() => {
      const disposers = []

      for (const sheet of STYLESHEETS) {
        disposers.push(host.webServer.register({
          kind: 'exact',
          path: sheet.url,
          handler: (request, response) => {
            sendAsset(request, response, 'text/css; charset=utf-8', 'no-cache', readAsset(sheet.file))
          },
        }))
      }

      for (const font of fonts) {
        disposers.push(host.webServer.register({
          kind: 'exact',
          path: `${ROUTE_PREFIX}/assets/fonts/${font.name}`,
          handler: (request, response) => {
            sendAsset(request, response, 'font/woff2', 'public, max-age=31536000, immutable', font.body)
          },
        }))
      }

      const tags = STYLESHEETS
        .map(sheet => `<link rel="stylesheet" href="${sheet.url}" data-claude-lite>`)
        .join('')

      disposers.push(host.webServer.tapIndex((html) => {
        if (html.includes('data-claude-lite')) return html
        return html.replace('</head>', `${tags}</head>`)
      }))

      return () => { for (const dispose of disposers) dispose() }
    })
  })
}
