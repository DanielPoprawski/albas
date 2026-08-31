import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

// Both entry HTML files sit at the project root. Bun derives each output path
// from the entrypoints' common ancestor, so an entry under src/ would land at
// dist/src/index.html with "../chunk-*.js" asset references — servable only by
// accident, since those resolve against the URL path rather than the file's
// location. Keeping them level puts index.html at the root of dist/ with the
// asset links nginx actually needs.
const entrypoints = ["admin.html", "index.html"];

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [tailwind],
  minify: true,
  target: "browser",
  // Root-absolute asset URLs. The default is relative, which resolves against
  // the *URL* the browser is on, not the file's location — and every route here
  // except "/" is a client-side path served by the same index.html, so a
  // relative link is only correct by coincidence of depth.
  publicPath: "/",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

for (const output of result.outputs) {
  console.log(` ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
