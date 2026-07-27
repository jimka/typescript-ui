# Third-Party Notices

`@jimka/typescript-ui` redistributes, or depends on, the third-party components
listed below. This file reproduces the attribution and license notices those
components require.

It covers two groups:

1. **Bundled components** — code or assets embedded in the files shipped in
   `dist/lib`. Their notices are reproduced in full here because this package
   redistributes them.
2. **Runtime dependencies** — declared as `dependencies` / optional
   `peerDependencies` and installed separately from npm into the consumer's
   `node_modules`. They are **not** bundled into this package, so each ships its
   own license text within its own package; they are listed here for completeness
   and for downstream redistributors who bundle a final application.

The library's own source code is licensed separately — see [LICENSE](./LICENSE)
(PolyForm Noncommercial License 1.0.0).

---

## 1. Components bundled in this package (`dist/lib`)

### Font Awesome Free 7.2.0 — icon path data

Icon path data derived from Font Awesome Free 7.2.0, © Fonticons, Inc., licensed
under the Creative Commons Attribution 4.0 International License (CC BY 4.0).
Full attribution, the list of modifications, and license details are in
[LICENSE-FONTAWESOME.md](./LICENSE-FONTAWESOME.md) (also shipped in this package).

### Manrope — variable font, Latin & Latin-Extended subsets

The Latin and Latin-Extended subsets of the Manrope variable font are embedded
(as WOFF2 data) in this package's theme assets. `Manrope` is a Reserved Font Name
under the license below.

```
Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### d3 (charting math)

The chart module inlines d3 into `dist/lib/component/chart.es.js`. Its entry
points (`scaleLinear`/`scaleTime`, `line`, `extent`, `tickFormat`, …) pull in the
following d3 packages **and their transitive dependencies** — all by the same
author under the same license. Every one is licensed under the ISC License:

```
Copyright 2010-2023 Mike Bostock   (d3-array)
Copyright 2010-2022 Mike Bostock   (d3-color)
Copyright 2010-2026 Mike Bostock   (d3-format)
Copyright 2010-2021 Mike Bostock   (d3-interpolate)
Copyright 2015-2022 Mike Bostock   (d3-path)
Copyright 2010-2021 Mike Bostock   (d3-scale)
Copyright 2010-2022 Mike Bostock   (d3-shape)
Copyright 2010-2022 Mike Bostock   (d3-time)
Copyright 2010-2021 Mike Bostock   (d3-time-format)
Copyright 2021 Mike Bostock        (internmap)

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

---

## 2. Runtime dependencies (installed separately, not bundled)

These are installed from npm alongside this package and ship their own license
texts in their own packages. Listed here for completeness.

### MIT License

- **CodeMirror 6** — `codemirror`, `@codemirror/*`, `@lezer/*` — © 2018–2021 Marijn Haverbeke and others
- **Lexical** — `lexical`, `@lexical/*` — © Meta Platforms, Inc. and affiliates
- **marked** — © 2018+ MarkedJS (https://github.com/markedjs/); © 2011–2018 Christopher Jeffrey (https://github.com/chjj/)
- **prettier** — © James Long and contributors
- **sql-formatter** — © 2016–2020 ZeroTurnaround LLC; © 2020–2021 George Leslie-Waksman and other contributors; © 2021–present inferrinizzard and other contributors

All of the above are distributed under the MIT License:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Eclipse Public License 2.0

- **elkjs** — the Eclipse Layout Kernel (JavaScript), © Kiel University and
  contributors, licensed under `EPL-2.0 OR GPL-3.0-or-later`: the Eclipse Public
  License 2.0, with GPL-3.0-or-later offered as a Secondary License. This
  package neither bundles elkjs nor combines it with GPL-covered code, so the
  EPL-2.0 terms are the ones that govern here. Full text:
  <https://www.eclipse.org/legal/epl-2.0/> (also shipped as `LICENSE.md` in the
  `elkjs` package, which names the Secondary License); the Secondary License
  text is at <https://www.gnu.org/licenses/gpl-3.0-standalone.html>.

  elkjs is an **optional** peer dependency, used only by the `component/diagram`
  features. It is consumed as a separate, unmodified module (loaded via a dynamic
  `import("elkjs/…")`) — it is neither bundled into nor modified by this package.
