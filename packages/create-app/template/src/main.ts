import { Body } from '@jimka/typescript-ui/core'
import { Fit } from '@jimka/typescript-ui/layout'
import { Header } from '@jimka/typescript-ui/component/display'

async function main(): Promise<void> {
    const body = await Body.init({ layoutManager: Fit() })

    body.addComponent(Header('Hello from typescript-ui'))
}

void main()
