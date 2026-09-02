import { Body } from '@jimka/typescript-ui/core'
import { Fit } from '@jimka/typescript-ui/layout'
import { Header } from '@jimka/typescript-ui/component/display'

Body.init({
    layoutManager: Fit(),
    components: [Header('Hello from typescript-ui')],
})
