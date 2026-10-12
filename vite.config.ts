import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { embedExcalidrawFonts } from "./src/ui/embed-fonts";

export default defineConfig({
  plugins: [embedExcalidrawFonts(), react(), viteSingleFile()],
  define: { "process.env.IS_PREACT": "false" },
  build: {
    outDir: "dist/ui",
    assetsInlineLimit: 10_000_000,
    rollupOptions: { input: "mcp-app.html" },
  },
});
