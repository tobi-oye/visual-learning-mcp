import { copyFile, mkdir, rm, stat } from "node:fs/promises";

const output = new URL("../dist/worker-assets/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const [source, filename] of [
  [new URL("../dist/ui/mcp-app.html", import.meta.url), "mcp-app.html"],
  [new URL("../dist/host/host.html", import.meta.url), "host.html"],
] as const) {
  const { size } = await stat(source);
  if (size > 20 * 1024 * 1024) throw new Error(`${filename} exceeds the 20 MiB application asset limit.`);
  await copyFile(source, new URL(filename, output));
  console.log(`Worker asset: ${filename} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
}
