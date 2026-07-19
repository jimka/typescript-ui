import { Body } from '@jimka/typescript-ui/core'
import { Header } from '@jimka/typescript-ui/component/display'
import { moduleCount, symbolCount } from 'virtual:typedoc-summary'

// Minimal proof-of-seam: render one real @jimka/typescript-ui component — resolved
// through the package `exports` map exactly as a downstream consumer would — and
// surface the TypeDoc model counts read at build time by the vite plugin.
const body = Body.getInstance()
body.addComponent(new Header({ text: `typescript-ui docs — ${moduleCount} modules, ${symbolCount} documented symbols` }))
