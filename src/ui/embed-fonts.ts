import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Excalidraw constructs FontFace objects from runtime URL strings. Inline its
 * packaged Latin fonts during compilation, including handwriting and code fonts,
 * without changing Excalidraw's font loading or export implementation.
 */
export function embedExcalidrawFonts(): Plugin {
  const cache = new Map<string, string>();
  return {
    name: "embed-excalidraw-fonts",
    enforce: "pre",
    transform(source, id) {
      const file = id.split("?")[0];
      if (!file.includes("/@excalidraw/excalidraw/dist/") || !file.endsWith(".js")) return;
      const code = source.replace(
        /(["'])(\.\/fonts\/(?:Cascadia|ComicShanns|Excalifont|Liberation|Lilita|Nunito|Virgil)\/[^"']+\.woff2)\1/g,
        (_match, _quote: string, uri: string) => {
          const path = resolve(dirname(file), uri);
          let data = cache.get(path);
          if (!data) {
            data = `data:font/woff2;base64,${readFileSync(path).toString("base64")}`;
            cache.set(path, data);
          }
          return JSON.stringify(data);
        },
      );
      return code === source ? null : { code, map: null };
    },
  };
}
