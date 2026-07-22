/// <reference types="vite/client" />

declare module 'virtual:typedoc-api' {
  /** Every generated API page, as a path relative to packages/lib/docs/api. */
  export const apiFiles: string[]
  /** TypeDoc's own navigation tree, normalized to app routes. */
  export const apiNav: ApiNavNode[]
  export const moduleCount: number
  export const symbolCount: number

  export interface ApiNavNode {
    label:    string
    /** The route this entry opens, or null for a grouping-only entry. */
    path:     string | null
    children: ApiNavNode[]
  }
}
