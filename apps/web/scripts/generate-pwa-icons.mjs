// Regenerates apps/web/public/icons/*.png from public/icons/kurrier-mark.svg.
// Run with: node scripts/generate-pwa-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "public", "icons");
const svgPath = join(iconsDir, "kurrier-mark.svg");
const svg = readFileSync(svgPath);

const BACKGROUND = "#ffffff";

async function writePng(buffer, outPath) {
	await sharp(buffer).png().toFile(outPath);
	console.log("wrote", outPath);
}

async function main() {
	// Plain icons: logo fills the canvas, transparent background.
	await writePng(await sharp(svg).resize(192, 192).png().toBuffer(), join(iconsDir, "icon-192.png"));
	await writePng(await sharp(svg).resize(512, 512).png().toBuffer(), join(iconsDir, "icon-512.png"));

	// Maskable icon: logo scaled down and centered on an opaque background so
	// it survives OS masking (circle/squircle/etc) without clipping content.
	const maskableLogo = await sharp(svg).resize(358, 358).toBuffer(); // ~70% of 512
	const maskable = await sharp({
		create: {
			width: 512,
			height: 512,
			channels: 4,
			background: BACKGROUND,
		},
	})
		.composite([{ input: maskableLogo, gravity: "center" }])
		.png()
		.toBuffer();
	await writePng(maskable, join(iconsDir, "icon-maskable-512.png"));

	// Apple touch icon: opaque background required, iOS renders transparency as black.
	const appleLogo = await sharp(svg).resize(140, 140).toBuffer(); // small margin
	const apple = await sharp({
		create: {
			width: 180,
			height: 180,
			channels: 4,
			background: BACKGROUND,
		},
	})
		.composite([{ input: appleLogo, gravity: "center" }])
		.png()
		.toBuffer();
	await writePng(apple, join(iconsDir, "apple-touch-icon.png"));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
