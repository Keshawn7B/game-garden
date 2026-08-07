import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../public/game-garden-logo-red.png", import.meta.url));
const destination = fileURLToPath(new URL("../public/game-garden-logo-gold.png", import.meta.url));

const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const hueToRgb = (p, q, sourceHue) => {
  let hue = sourceHue;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
};

for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset] / 255;
  const green = data[offset + 1] / 255;
  const blue = data[offset + 2] / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const saturation = maximum === minimum ? 0 : (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));

  if (red - Math.max(green, blue) < 0.08 || red < 0.28 || saturation < 0.2) continue;

  const goldHue = 43 / 360;
  const goldSaturation = Math.max(0.72, Math.min(1, saturation * 0.92));
  const q = lightness < 0.5
    ? lightness * (1 + goldSaturation)
    : lightness + goldSaturation - lightness * goldSaturation;
  const p = 2 * lightness - q;

  data[offset] = Math.round(hueToRgb(p, q, goldHue + 1 / 3) * 255);
  data[offset + 1] = Math.round(hueToRgb(p, q, goldHue) * 255);
  data[offset + 2] = Math.round(hueToRgb(p, q, goldHue - 1 / 3) * 255);
}

await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(destination);
console.log(`Created ${info.width}x${info.height} gold logo.`);
