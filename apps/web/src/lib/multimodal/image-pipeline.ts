import { type AllowedImageMimeType, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION_PX } from "@spark/shared";
import sharp from "sharp";

const MAX_INPUT_PIXELS = 25_000_000;

export class ImageValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ImageValidationError";
    this.statusCode = statusCode;
  }
}

export function detectImageMimeFromMagicBytes(buffer: Buffer): AllowedImageMimeType | null {
  if (buffer.length >= 8) {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (isPng) return "image/png";
  }

  if (buffer.length >= 3) {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (isJpeg) return "image/jpeg";
  }

  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }

  return null;
}

export interface NormalizedImageResult {
  buffer: Buffer;
  mimeType: AllowedImageMimeType;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * Validates magic bytes, guards against pixel bombs, applies EXIF auto orientation
 * before stripping metadata, and scales to at most 1568px on the longest edge.
 */
export async function normalizeDesignImage(input: Buffer): Promise<NormalizedImageResult> {
  if (input.byteLength === 0) {
    throw new ImageValidationError("Uploaded image file is empty.", 400);
  }

  if (input.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(
      `Image exceeds the ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB upload limit.`,
      413
    );
  }

  const detectedMime = detectImageMimeFromMagicBytes(input);
  if (!detectedMime) {
    throw new ImageValidationError(
      "Unsupported image format. Only PNG, JPEG, and WebP files are accepted.",
      400
    );
  }

  try {
    // By omitting .withMetadata(), sharp strips EXIF/IPTC/XMP after .rotate() applies orientation.
    let pipeline = sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION_PX,
        height: MAX_IMAGE_DIMENSION_PX,
        fit: "inside",
        withoutEnlargement: true,
      });

    switch (detectedMime) {
      case "image/png":
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
      case "image/jpeg":
        pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
        break;
      case "image/webp":
        pipeline = pipeline.webp({ quality: 88 });
        break;
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    if (!info.width || !info.height || info.width <= 0 || info.height <= 0) {
      throw new ImageValidationError("Image has invalid dimensions.", 400);
    }

    return {
      buffer: data,
      mimeType: detectedMime,
      sizeBytes: data.byteLength,
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    if (err instanceof ImageValidationError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Failed to process image";
    throw new ImageValidationError(
      message.toLowerCase().includes("pixel")
        ? "Image dimensions exceed the maximum allowed pixel budget."
        : "Uploaded file is not a valid PNG, JPEG, or WebP image.",
      400
    );
  }
}
