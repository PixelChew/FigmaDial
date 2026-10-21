// Bundles the Figma plugin: main thread code to dist/code.js, and the hidden UI script inlined into dist/ui.html
// (Figma loads the UI as a single HTML string, so it can't reference separate script files).
import * as esbuild from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const shared = { bundle: true, target: "es2017", logLevel: "info" };

await mkdir("dist", { recursive: true });

const writeUi = {
	name: "write-ui",
	setup(build) {
		build.onEnd(async (result) => {
			if (result.errors.length > 0) return;
			const js = result.outputFiles[0].text;
			await writeFile("dist/ui.html", `<!doctype html><html><body><script>${js}</script></body></html>\n`);
		});
	},
};

const contexts = await Promise.all([
	esbuild.context({ ...shared, entryPoints: ["src/code.ts"], outfile: "dist/code.js" }),
	esbuild.context({ ...shared, entryPoints: ["src/ui.ts"], outfile: "dist/ui.js", write: false, plugins: [writeUi] }),
]);

if (watch) {
	await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
	await Promise.all(contexts.map((ctx) => ctx.rebuild()));
	await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
