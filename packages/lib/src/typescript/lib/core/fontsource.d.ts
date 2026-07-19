// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Ambient stub for `.woff2` font assets imported as URLs (e.g. the
// @fontsource-variable/manrope subset files imported in Theme.ts). The bundler
// (Vite) rewrites each import to the emitted asset's URL string; this stub gives
// that import a type under `moduleResolution: bundler`, which otherwise rejects
// a module whose target is a binary asset with no type surface.
declare module '*.woff2' {
    const src: string;
    export default src;
}
