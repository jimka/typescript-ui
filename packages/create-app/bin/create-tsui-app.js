#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { main } from '../index.js';

main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
});
