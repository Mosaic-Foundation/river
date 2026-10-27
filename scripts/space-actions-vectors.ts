// Writes tests/conformance/space-actions/vectors.json from its builder (space-actions-1
// section 8). Deterministic: running it again changes nothing unless the builder changed.
//   npx tsx scripts/space-actions-vectors.ts
import fs from "node:fs";
import { buildVectors } from "../tests/conformance/space-actions/generate.js";
import { VECTORS_PATH } from "../tests/conformance/space-actions/suite.js";

const vectors = await buildVectors();
fs.writeFileSync(VECTORS_PATH, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`Wrote ${vectors.cases.length} cases and ${vectors.hosts.length} host cases to ${VECTORS_PATH}`);
