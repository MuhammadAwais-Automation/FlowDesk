// Bundles bin/flowdesk-mcp.mjs and its packages into one file for the
// installer (package.json build.extraResources -> resources/mcp). The
// installed FlowDesk.exe runs it with ELECTRON_RUN_AS_NODE=1, so users need
// neither Node nor the repo.
import { build } from 'esbuild'
import { cpSync, rmSync } from 'node:fs'

const outDir = 'out/mcp'
rmSync(outDir, { recursive: true, force: true })
await build({
  entryPoints: ['bin/flowdesk-mcp.mjs'],
  outfile: `${outDir}/flowdesk-mcp.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bundled CommonJS packages still call require().
  banner: { js: "import { createRequire as __fdCreateRequire } from 'node:module'; const require = __fdCreateRequire(import.meta.url);" },
  logLevel: 'warning',
})
cpSync('src/mcp-apps', `${outDir}/mcp-apps`, { recursive: true })
console.log(`MCP server bundled to ${outDir}`)
