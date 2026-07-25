import { Body } from '@jimka/typescript-ui/core'
import { Fit } from '@jimka/typescript-ui/layout'
import { Router, type RouteParams } from '@jimka/typescript-ui/router'
import { DocsShell } from './shell/DocsShell.js'

const DEFAULT_PATH = '/guide'

const router = new Router({ mode: 'history', base: import.meta.env.BASE_URL })
const shell  = new DocsShell(router)

function showDefaultPage(_params: RouteParams, _path: string, fragment: string): void {
    shell.showPath(DEFAULT_PATH, fragment)
}

function showRoutedPage(_params: RouteParams, path: string, fragment: string): void {
    shell.showPath(path, fragment)
}

router.register('/',  showDefaultPage)
router.register('/*', showRoutedPage)

Body.init({ layoutManager: Fit(), components: [shell] })

// start() applies the current route synchronously — call after the tree is
// built and before the first layout frame, so the routed page is already
// showing when that frame runs (no flash of the default page). See "Router
// wiring (main.ts)" in plans/implemented/packages-docs.md.
router.start()
