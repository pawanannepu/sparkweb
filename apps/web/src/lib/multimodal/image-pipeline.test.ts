// @vitest-environment node

import { MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION_PX } from "@spark/shared";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  detectImageMimeFromMagicBytes,
  ImageValidationError,
  normalizeDesignImage,
} from "./image-pipeline";

describe("image-pipeline", () => {
  // covers: AC-4
  it("detects PNG, JPEG, and WebP magic bytes and rejects unsupported signatures", async () => {
    const pngBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const jpegBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const webpBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .webp()
      .toBuffer();

    expect(detectImageMimeFromMagicBytes(pngBuf)).toBe("image/png");
    expect(detectImageMimeFromMagicBytes(jpegBuf)).toBe("image/jpeg");
    expect(detectImageMimeFromMagicBytes(webpBuf)).toBe("image/webp");
    expect(detectImageMimeFromMagicBytes(Buffer.from("GIF89a..."))).toBeNull();
    expect(detectImageMimeFromMagicBytes(Buffer.from("<svg></svg>"))).toBeNull();
  });

  // covers: AC-4
  it("rejects empty files, oversized files, and non image buffers with ImageValidationError", async () => {
    await expect(normalizeDesignImage(Buffer.alloc(0))).rejects.toMatchObject({
      name: "ImageValidationError",
      statusCode: 400,
    });

    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(normalizeDesignImage(oversized)).rejects.toMatchObject({
      name: "ImageValidationError",
      statusCode: 413,
    });

    const fakePng = Buffer.from("<svg>not an image</svg>");
    await expect(normalizeDesignImage(fakePng)).rejects.toBeInstanceOf(ImageValidationError);
  });

  // covers: AC-4
  it("resizes oversized images to at most 1568px without enlarging small images and strips EXIF metadata", async () => {
    const largeJpegWithExif = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: { r: 30, g: 60, b: 120 } },
    })
      .withMetadata({ exif: { IFD0: { ImageDescription: "secret-camera-model" } } })
      .jpeg()
      .toBuffer();

    const normalizedLarge = await normalizeDesignImage(largeJpegWithExif);
    expect(normalizedLarge.mimeType).toBe("image/jpeg");
    expect(normalizedLarge.width).toBe(MAX_IMAGE_DIMENSION_PX);
    expect(normalizedLarge.height).toBe(784);
    expect(normalizedLarge.sizeBytes).toBe(normalizedLarge.buffer.byteLength);

    const metaAfter = await sharp(normalizedLarge.buffer).metadata();
    expect(metaAfter.exif).toBeUndefined();

    const smallPng = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const normalizedSmall = await normalizeDesignImage(smallPng);
    expect(normalizedSmall.mimeType).toBe("image/png");
    expect(normalizedSmall.width).toBe(320);
    expect(normalizedSmall.height).toBe(240);
  });

  // covers: AC-4
  it("applies EXIF orientation before stripping metadata when rotating", async () => {
    const oriented = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await normalizeDesignImage(oriented);
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.orientation).toBeUndefined();
  });
});
