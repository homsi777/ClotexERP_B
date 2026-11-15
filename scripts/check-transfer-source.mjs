// Syntax checks for changed TS/TSX and strict checking of dependency-free selection helpers.
// Pass the path of an already-installed TypeScript compiler; does not install anything.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require(path.resolve(process.argv[2]));
const files = [
  'src/components/TransferRollPicker.tsx', 'src/pages/inventory/Transfers.tsx',
  'src/lib/inventory/transferSelection.ts', 'src/lib/inventory/transferSelection.test.ts',
  'src/lib/api/inventoryTransfersApi.ts', 'server/src/routes/inventoryTransferRoutes.ts',
  'server/src/routes/fabricRollRoutes.ts', 'server/src/services/inventoryTransferService.ts',
  'server/src/services/inventoryTransferValidation.ts', 'server/src/services/inventoryTransferService.test.ts',
  'server/src/services/inventoryTransfer.integration.test.ts',
];
let diagnostics = [];
for (const file of files) {
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
  });
  diagnostics.push(...(result.diagnostics ?? []));
}
const program = ts.createProgram(['src/lib/inventory/transferSelection.ts'], {
  noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, skipLibCheck: true,
});
diagnostics.push(...ts.getPreEmitDiagnostics(program));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: (f) => f, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log(`Syntax OK: ${files.length} files; strict types OK: transferSelection.ts. Full project types require project dependencies.`);
