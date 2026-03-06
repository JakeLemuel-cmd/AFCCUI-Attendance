export interface VoterCardTemplateLayout {
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  headerColor: string;
  headerHeight: number;
  headerText: string;
  headerTextColor: string;
  headerTextX: number;
  headerTextY: number;
  logoDataUrl: string;
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoHeight: number;
  cardTemplateImageDataUrl: string;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  cardRadius: number;
  cardFillColor: string;
  cardBorderColor: string;
  cardBorderWidth: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  qrBorderColor: string;
  qrBorderWidth: number;
  textX: number;
  nameY: number;
  nameFontSize: number;
  branchY: number;
  branchFontSize: number;
  footerY: number;
  nameColor: string;
  branchColor: string;
  footerColor: string;
  footerText: string;
}

const STORAGE_KEY = "coopvote.voter_qr_card_template.v1";

export const DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT: VoterCardTemplateLayout = {
  canvasWidth: 1200,
  canvasHeight: 760,
  backgroundColor: "#f3f4f6",
  headerColor: "#047857",
  headerHeight: 108,
  headerText: "ID Cards With QR Codes",
  headerTextColor: "#ffffff",
  headerTextX: 88,
  headerTextY: 72,
  logoDataUrl: "",
  logoX: 980,
  logoY: 18,
  logoWidth: 180,
  logoHeight: 72,
  cardTemplateImageDataUrl: "",
  cardX: 160,
  cardY: 170,
  cardWidth: 880,
  cardHeight: 470,
  cardRadius: 56,
  cardFillColor: "#ffffff",
  cardBorderColor: "#15803d",
  cardBorderWidth: 4,
  qrX: 230,
  qrY: 280,
  qrSize: 280,
  qrBorderColor: "#111827",
  qrBorderWidth: 2,
  textX: 580,
  nameY: 380,
  nameFontSize: 52,
  branchY: 465,
  branchFontSize: 42,
  footerY: 540,
  nameColor: "#111827",
  branchColor: "#334155",
  footerColor: "#6b7280",
  footerText: "",
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function toStringValue(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function toOptionalStringValue(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

export function sanitizeVoterCardTemplateLayout(partial: Partial<VoterCardTemplateLayout>): VoterCardTemplateLayout {
  const fallback = DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT;
  const normalizedFooterText = toOptionalStringValue(partial.footerText, fallback.footerText);
  const footerText = normalizedFooterText.toLowerCase() === "coop vote" ? "" : normalizedFooterText;

  return {
    canvasWidth: clampNumber(partial.canvasWidth, fallback.canvasWidth, 800, 2000),
    canvasHeight: clampNumber(partial.canvasHeight, fallback.canvasHeight, 500, 1500),
    backgroundColor: toStringValue(partial.backgroundColor, fallback.backgroundColor),
    headerColor: toStringValue(partial.headerColor, fallback.headerColor),
    headerHeight: clampNumber(partial.headerHeight, fallback.headerHeight, 70, 220),
    headerText: toStringValue(partial.headerText, fallback.headerText),
    headerTextColor: toStringValue(partial.headerTextColor, fallback.headerTextColor),
    headerTextX: clampNumber(partial.headerTextX, fallback.headerTextX, 20, 1500),
    headerTextY: clampNumber(partial.headerTextY, fallback.headerTextY, 30, 500),
    logoDataUrl: toOptionalStringValue(partial.logoDataUrl, fallback.logoDataUrl),
    logoX: clampNumber(partial.logoX, fallback.logoX, 20, 1800),
    logoY: clampNumber(partial.logoY, fallback.logoY, 10, 1300),
    logoWidth: clampNumber(partial.logoWidth, fallback.logoWidth, 60, 900),
    logoHeight: clampNumber(partial.logoHeight, fallback.logoHeight, 30, 600),
    cardTemplateImageDataUrl: toOptionalStringValue(partial.cardTemplateImageDataUrl, fallback.cardTemplateImageDataUrl),
    cardX: clampNumber(partial.cardX, fallback.cardX, 20, 1700),
    cardY: clampNumber(partial.cardY, fallback.cardY, 20, 1300),
    cardWidth: clampNumber(partial.cardWidth, fallback.cardWidth, 300, 1700),
    cardHeight: clampNumber(partial.cardHeight, fallback.cardHeight, 220, 1200),
    cardRadius: clampNumber(partial.cardRadius, fallback.cardRadius, 0, 200),
    cardFillColor: toStringValue(partial.cardFillColor, fallback.cardFillColor),
    cardBorderColor: toStringValue(partial.cardBorderColor, fallback.cardBorderColor),
    cardBorderWidth: clampNumber(partial.cardBorderWidth, fallback.cardBorderWidth, 0, 20),
    qrX: clampNumber(partial.qrX, fallback.qrX, 20, 1800),
    qrY: clampNumber(partial.qrY, fallback.qrY, 20, 1300),
    qrSize: clampNumber(partial.qrSize, fallback.qrSize, 120, 900),
    qrBorderColor: toStringValue(partial.qrBorderColor, fallback.qrBorderColor),
    qrBorderWidth: clampNumber(partial.qrBorderWidth, fallback.qrBorderWidth, 0, 12),
    textX: clampNumber(partial.textX, fallback.textX, 20, 1800),
    nameY: clampNumber(partial.nameY, fallback.nameY, 20, 1300),
    nameFontSize: clampNumber(partial.nameFontSize, fallback.nameFontSize, 16, 140),
    branchY: clampNumber(partial.branchY, fallback.branchY, 20, 1300),
    branchFontSize: clampNumber(partial.branchFontSize, fallback.branchFontSize, 14, 120),
    footerY: clampNumber(partial.footerY, fallback.footerY, 20, 1300),
    nameColor: toStringValue(partial.nameColor, fallback.nameColor),
    branchColor: toStringValue(partial.branchColor, fallback.branchColor),
    footerColor: toStringValue(partial.footerColor, fallback.footerColor),
    footerText,
  };
}

export function getStoredVoterCardTemplateLayout() {
  if (typeof window === "undefined") {
    return DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT;
    }

    const parsed = JSON.parse(raw) as Partial<VoterCardTemplateLayout>;
    return sanitizeVoterCardTemplateLayout(parsed);
  } catch {
    return DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT;
  }
}

export function saveVoterCardTemplateLayout(layout: Partial<VoterCardTemplateLayout>) {
  if (typeof window === "undefined") {
    return;
  }

  const sanitized = sanitizeVoterCardTemplateLayout(layout);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
}

export function resetVoterCardTemplateLayout() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

function loadImage(src: string, errorMessage: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorMessage));
    image.src = src;
  });
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawQrPlaceholder(context: CanvasRenderingContext2D, layout: VoterCardTemplateLayout) {
  context.fillStyle = "#ffffff";
  context.fillRect(layout.qrX, layout.qrY, layout.qrSize, layout.qrSize);

  if (layout.qrBorderWidth > 0) {
    context.lineWidth = layout.qrBorderWidth;
    context.strokeStyle = layout.qrBorderColor;
    context.strokeRect(layout.qrX, layout.qrY, layout.qrSize, layout.qrSize);
  }

  const corner = Math.max(24, Math.floor(layout.qrSize * 0.18));
  const offset = Math.max(10, Math.floor(layout.qrSize * 0.07));
  context.lineWidth = Math.max(6, Math.floor(layout.qrSize * 0.035));
  context.strokeStyle = "#111827";
  context.strokeRect(layout.qrX + offset, layout.qrY + offset, corner, corner);
  context.strokeRect(layout.qrX + layout.qrSize - offset - corner, layout.qrY + offset, corner, corner);
  context.strokeRect(layout.qrX + offset, layout.qrY + layout.qrSize - offset - corner, corner, corner);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to generate QR card image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

interface DetectedQrBounds {
  x: number;
  y: number;
  size: number;
}

interface ImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectedTextLayout {
  textX: number;
  nameBaselineY: number;
  branchBaselineY: number;
  nameFontSize: number;
  branchFontSize: number;
}

function trimTextToWidth(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) {
    return value;
  }

  let trimmed = value;
  while (trimmed.length > 1 && context.measureText(trimmed).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

function wrapTextToLines(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number
) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return ["-"];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;

    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

      if (current) {
        if (lines.length === maxLines - 1) {
          lines.push(trimTextToWidth(context, current, maxWidth));
          return lines;
        }

      lines.push(current);
      current = "";
    }

    if (context.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }

    let rest = word;
      while (rest.length > 0) {
        let chunk = rest;
        while (chunk.length > 1 && context.measureText(chunk).width > maxWidth) {
          chunk = chunk.slice(0, -1);
        }

        if (lines.length === maxLines - 1) {
          lines.push(trimTextToWidth(context, rest, maxWidth));
          return lines;
        }

      lines.push(chunk);
      rest = rest.slice(chunk.length);
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

function getPointX(point: unknown) {
  if (point && typeof point === "object") {
    const candidate = point as { x?: number; getX?: () => number };
    if (typeof candidate.getX === "function") {
      return candidate.getX();
    }

    if (typeof candidate.x === "number") {
      return candidate.x;
    }
  }

  return null;
}

function getPointY(point: unknown) {
  if (point && typeof point === "object") {
    const candidate = point as { y?: number; getY?: () => number };
    if (typeof candidate.getY === "function") {
      return candidate.getY();
    }

    if (typeof candidate.y === "number") {
      return candidate.y;
    }
  }

  return null;
}

function detectCardBoundsFromBackground(rgba: Uint8ClampedArray, width: number, height: number): ImageBounds | null {
  const step = Math.max(1, Math.round(Math.min(width, height) / 140));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let x = 0; x < width; x += step) {
    const topIndex = x * 4;
    red += rgba[topIndex];
    green += rgba[topIndex + 1];
    blue += rgba[topIndex + 2];
    count += 1;

    const bottomIndex = ((height - 1) * width + x) * 4;
    red += rgba[bottomIndex];
    green += rgba[bottomIndex + 1];
    blue += rgba[bottomIndex + 2];
    count += 1;
  }

  for (let y = 0; y < height; y += step) {
    const leftIndex = y * width * 4;
    red += rgba[leftIndex];
    green += rgba[leftIndex + 1];
    blue += rgba[leftIndex + 2];
    count += 1;

    const rightIndex = (y * width + (width - 1)) * 4;
    red += rgba[rightIndex];
    green += rgba[rightIndex + 1];
    blue += rgba[rightIndex + 2];
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  const baseRed = red / count;
  const baseGreen = green / count;
  const baseBlue = blue / count;
  const threshold = 32;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (rgba[index + 3] < 10) {
        continue;
      }

      const distance =
        Math.abs(rgba[index] - baseRed) +
        Math.abs(rgba[index + 1] - baseGreen) +
        Math.abs(rgba[index + 2] - baseBlue);
      if (distance <= threshold) {
        continue;
      }

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(width - 1, maxX + 2);
  maxY = Math.min(height - 1, maxY + 2);

  const boundsWidth = maxX - minX + 1;
  const boundsHeight = maxY - minY + 1;
  if (boundsWidth < width * 0.35 || boundsHeight < height * 0.25) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: boundsWidth,
    height: boundsHeight,
  };
}

async function detectQrBoundsWithZxing(imageSrc: string): Promise<DetectedQrBounds | null> {
  try {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const reader = new BrowserQRCodeReader();
    const result = await reader.decodeFromImageUrl(imageSrc);
    const rawPoints = result?.getResultPoints?.();
    if (!rawPoints || rawPoints.length < 3) {
      return null;
    }

    const xs: number[] = [];
    const ys: number[] = [];
    rawPoints.forEach((point) => {
      const x = getPointX(point);
      const y = getPointY(point);
      if (typeof x === "number" && typeof y === "number") {
        xs.push(x);
        ys.push(y);
      }
    });

    if (xs.length < 3 || ys.length < 3) {
      return null;
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pointSpan = Math.max(maxX - minX, maxY - minY);
    const padding = Math.max(6, Math.round(pointSpan * 0.35));
    const size = Math.max(24, Math.round(pointSpan + padding * 2));

    return {
      x: Math.max(0, Math.round(minX - padding)),
      y: Math.max(0, Math.round(minY - padding)),
      size,
    };
  } catch {
    return null;
  }
}

function detectQrBoundsHeuristic(luma: Uint8ClampedArray, width: number, height: number): DetectedQrBounds | null {
  const minSide = Math.min(width, height);
  const minSize = Math.max(48, Math.round(minSide * 0.12));
  const maxSize = Math.max(minSize, Math.round(minSide * 0.52));
  const sizes: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    const ratio = i / 8;
    sizes.push(Math.round(minSize + (maxSize - minSize) * ratio));
  }

  let best: DetectedQrBounds | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const size of sizes) {
    const sampleGrid = 11;
    const sampleStep = size / (sampleGrid - 1);
    const stride = Math.max(8, Math.round(size / 7));

    for (let y = 0; y <= height - size; y += stride) {
      for (let x = 0; x <= width - size; x += stride) {
        let sum = 0;
        let sumSquares = 0;
        let dark = 0;
        let transitions = 0;
        let prevRow: number[] | null = null;

        for (let gy = 0; gy < sampleGrid; gy += 1) {
          const row: number[] = [];
          const py = Math.min(height - 1, Math.round(y + gy * sampleStep));

          for (let gx = 0; gx < sampleGrid; gx += 1) {
            const px = Math.min(width - 1, Math.round(x + gx * sampleStep));
            const value = luma[(py * width + px) * 4];
            row.push(value);
            sum += value;
            sumSquares += value * value;
            if (value < 140) {
              dark += 1;
            }
            if (gx > 0 && Math.abs(row[gx] - row[gx - 1]) > 28) {
              transitions += 1;
            }
          }

          if (prevRow) {
            for (let gx = 0; gx < sampleGrid; gx += 1) {
              if (Math.abs(row[gx] - prevRow[gx]) > 28) {
                transitions += 1;
              }
            }
          }

          prevRow = row;
        }

        const samples = sampleGrid * sampleGrid;
        const mean = sum / samples;
        const variance = sumSquares / samples - mean * mean;
        const darkRatio = dark / samples;
        const balanceScore = 1 - Math.min(1, Math.abs(darkRatio - 0.5) * 2);
        const transitionScore = transitions / (sampleGrid * (sampleGrid - 1) * 2);
        const centralityPenalty = Math.abs((x + size / 2) / width - 0.35) * 20;
        const score = variance * 0.42 + transitionScore * 180 + balanceScore * 45 - centralityPenalty;

        if (score > bestScore) {
          bestScore = score;
          best = { x, y, size };
        }
      }
    }
  }

  if (!best || bestScore < 35) {
    return null;
  }

  return best;
}

function detectTextLayout(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  qr: DetectedQrBounds | null
): DetectedTextLayout | null {
  const leftBoundary = qr
    ? Math.min(width - 2, Math.max(0, qr.x + qr.size + Math.round(width * 0.03)))
    : Math.round(width * 0.33);
  const rightBoundary = Math.max(leftBoundary + 20, width - Math.round(width * 0.04));
  const topBoundary = Math.round(height * 0.14);
  const bottomBoundary = Math.max(topBoundary + 20, height - Math.round(height * 0.08));
  const regionWidth = rightBoundary - leftBoundary;
  if (regionWidth < 40) {
    return null;
  }

  let luminanceSum = 0;
  let luminanceSquares = 0;
  let luminanceCount = 0;
  for (let y = topBoundary; y <= bottomBoundary; y += 1) {
    for (let x = leftBoundary; x <= rightBoundary; x += 1) {
      const index = (y * width + x) * 4;
      const value = (rgba[index] * 0.2126 + rgba[index + 1] * 0.7152 + rgba[index + 2] * 0.0722) | 0;
      luminanceSum += value;
      luminanceSquares += value * value;
      luminanceCount += 1;
    }
  }

  const mean = luminanceCount > 0 ? luminanceSum / luminanceCount : 140;
  const variance = luminanceCount > 0 ? luminanceSquares / luminanceCount - mean * mean : 900;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const darkThreshold = Math.max(70, Math.min(190, Math.round(mean - stdDev * 0.32)));
  const rowCounts: number[] = new Array(height).fill(0);
  for (let y = topBoundary; y <= bottomBoundary; y += 1) {
    let rowDark = 0;
    for (let x = leftBoundary; x <= rightBoundary; x += 1) {
      const index = (y * width + x) * 4;
      const value = (rgba[index] * 0.2126 + rgba[index + 1] * 0.7152 + rgba[index + 2] * 0.0722) | 0;
      if (value < darkThreshold) {
        rowDark += 1;
      }
    }
    rowCounts[y] = rowDark;
  }

  const rowThreshold = Math.max(8, Math.round(regionWidth * 0.028));
  const clusters: Array<{ start: number; end: number; peak: number }> = [];
  let activeStart = -1;
  let activePeak = 0;

  for (let y = topBoundary; y <= bottomBoundary; y += 1) {
    const count = rowCounts[y];
    if (count >= rowThreshold) {
      if (activeStart === -1) {
        activeStart = y;
        activePeak = count;
      } else {
        activePeak = Math.max(activePeak, count);
      }
    } else if (activeStart !== -1) {
      const end = y - 1;
      if (end - activeStart + 1 >= 3) {
        clusters.push({ start: activeStart, end, peak: activePeak });
      }
      activeStart = -1;
      activePeak = 0;
    }
  }

  if (activeStart !== -1) {
    const end = bottomBoundary;
    if (end - activeStart + 1 >= 3) {
      clusters.push({ start: activeStart, end, peak: activePeak });
    }
  }

  if (clusters.length === 0) {
    return null;
  }

  clusters.sort((a, b) => a.start - b.start);
  const nameCluster = clusters[0];
  const branchCluster = clusters[1] ?? {
    start: nameCluster.end + Math.max(10, Math.round((nameCluster.end - nameCluster.start + 1) * 0.8)),
    end: nameCluster.end + Math.max(20, Math.round((nameCluster.end - nameCluster.start + 1) * 1.8)),
    peak: Math.max(1, Math.round(nameCluster.peak * 0.7)),
  };

  const clusterTop = Math.min(nameCluster.start, branchCluster.start);
  const clusterBottom = Math.max(nameCluster.end, branchCluster.end);
  const columnThreshold = Math.max(2, Math.round((clusterBottom - clusterTop + 1) * 0.16));

  let textX = leftBoundary;
  for (let x = leftBoundary; x <= rightBoundary; x += 1) {
    let count = 0;
    for (let y = clusterTop; y <= clusterBottom; y += 1) {
      const index = (y * width + x) * 4;
      const value = (rgba[index] * 0.2126 + rgba[index + 1] * 0.7152 + rgba[index + 2] * 0.0722) | 0;
      if (value < darkThreshold) {
        count += 1;
      }
    }
    if (count >= columnThreshold) {
      textX = x;
      break;
    }
  }

  const nameHeight = Math.max(3, nameCluster.end - nameCluster.start + 1);
  const branchHeight = Math.max(3, branchCluster.end - branchCluster.start + 1);
  const nameBaselineY = nameCluster.end + Math.max(2, Math.round(nameHeight * 0.28));
  const branchBaselineY = branchCluster.end + Math.max(2, Math.round(branchHeight * 0.28));

  return {
    textX,
    nameBaselineY,
    branchBaselineY,
    nameFontSize: Math.max(10, Math.round(nameHeight * 1.8)),
    branchFontSize: Math.max(10, Math.round(branchHeight * 1.8)),
  };
}

export async function deriveTemplateLayoutFromReferenceImage(
  baseLayout: VoterCardTemplateLayout,
  imageDataUrl: string
) {
  const image = await loadImage(imageDataUrl, "Unable to analyze template image.");
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to analyze template image.");
  }

  context.drawImage(image, 0, 0, width, height);
  const fullImageData = context.getImageData(0, 0, width, height).data;
  const cardBounds = detectCardBoundsFromBackground(fullImageData, width, height);

  let analysisWidth = width;
  let analysisHeight = height;
  let analysisData = fullImageData;
  let analysisImageDataUrl = imageDataUrl;

  if (cardBounds) {
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = cardBounds.width;
    croppedCanvas.height = cardBounds.height;
    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) {
      throw new Error("Unable to analyze template image.");
    }

    croppedContext.drawImage(
      image,
      cardBounds.x,
      cardBounds.y,
      cardBounds.width,
      cardBounds.height,
      0,
      0,
      cardBounds.width,
      cardBounds.height
    );
    analysisWidth = cardBounds.width;
    analysisHeight = cardBounds.height;
    analysisData = croppedContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
    analysisImageDataUrl = croppedCanvas.toDataURL("image/png");
  }

  const qrBoundsFromReader = await detectQrBoundsWithZxing(analysisImageDataUrl);
  const qrBounds = qrBoundsFromReader ?? detectQrBoundsHeuristic(analysisData, analysisWidth, analysisHeight);
  let textLayout = detectTextLayout(analysisData, analysisWidth, analysisHeight, qrBounds);

  if (!textLayout && qrBounds) {
    const fallbackTextX = Math.min(analysisWidth - 20, qrBounds.x + qrBounds.size + Math.round(analysisWidth * 0.05));
    const fallbackNameY = Math.round(qrBounds.y + qrBounds.size * 0.42);
    const fallbackBranchY = fallbackNameY + Math.max(20, Math.round(analysisHeight * 0.14));
    textLayout = {
      textX: fallbackTextX,
      nameBaselineY: fallbackNameY,
      branchBaselineY: fallbackBranchY,
      nameFontSize: Math.max(18, Math.round(analysisHeight * 0.095)),
      branchFontSize: Math.max(14, Math.round(analysisHeight * 0.078)),
    };
  }

  const scaleX = baseLayout.cardWidth / analysisWidth;
  const scaleY = baseLayout.cardHeight / analysisHeight;
  const mapped: Partial<VoterCardTemplateLayout> = {
    ...baseLayout,
    cardTemplateImageDataUrl: analysisImageDataUrl,
  };

  if (qrBounds) {
    mapped.qrX = Math.round(baseLayout.cardX + qrBounds.x * scaleX);
    mapped.qrY = Math.round(baseLayout.cardY + qrBounds.y * scaleY);
    mapped.qrSize = Math.max(24, Math.round(qrBounds.size * ((scaleX + scaleY) / 2)));
  }

  if (textLayout) {
    mapped.textX = Math.round(baseLayout.cardX + textLayout.textX * scaleX);
    mapped.nameY = Math.round(baseLayout.cardY + textLayout.nameBaselineY * scaleY);
    mapped.branchY = Math.round(baseLayout.cardY + textLayout.branchBaselineY * scaleY);
    mapped.nameFontSize = Math.max(10, Math.round(textLayout.nameFontSize * scaleY));
    mapped.branchFontSize = Math.max(10, Math.round(textLayout.branchFontSize * scaleY));
  }

  return sanitizeVoterCardTemplateLayout(mapped);
}

interface RenderVoterQrCardOptions {
  qrDataUrl?: string;
  voterName?: string;
  branch?: string;
  layout?: Partial<VoterCardTemplateLayout>;
  showData?: boolean;
}

export async function buildVoterQrCardCanvas(options: RenderVoterQrCardOptions) {
  const resolvedLayout = sanitizeVoterCardTemplateLayout({
    ...getStoredVoterCardTemplateLayout(),
    ...(options.layout ?? {}),
  });
  const showData = options.showData ?? true;

  const canvas = document.createElement("canvas");
  canvas.width = resolvedLayout.canvasWidth;
  canvas.height = resolvedLayout.canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare QR card canvas.");
  }

  context.fillStyle = resolvedLayout.backgroundColor;
  context.fillRect(0, 0, resolvedLayout.canvasWidth, resolvedLayout.canvasHeight);

  if (resolvedLayout.cardTemplateImageDataUrl) {
    try {
      const cardTemplateImage = await loadImage(resolvedLayout.cardTemplateImageDataUrl, "Unable to render card template image.");
      context.save();
      roundedRectPath(
        context,
        resolvedLayout.cardX,
        resolvedLayout.cardY,
        resolvedLayout.cardWidth,
        resolvedLayout.cardHeight,
        resolvedLayout.cardRadius
      );
      context.clip();
      context.drawImage(
        cardTemplateImage,
        resolvedLayout.cardX,
        resolvedLayout.cardY,
        resolvedLayout.cardWidth,
        resolvedLayout.cardHeight
      );
      context.restore();

      if (resolvedLayout.cardBorderWidth > 0) {
        context.save();
        roundedRectPath(
          context,
          resolvedLayout.cardX,
          resolvedLayout.cardY,
          resolvedLayout.cardWidth,
          resolvedLayout.cardHeight,
          resolvedLayout.cardRadius
        );
        context.lineWidth = resolvedLayout.cardBorderWidth;
        context.strokeStyle = resolvedLayout.cardBorderColor;
        context.stroke();
        context.restore();
      }
    } catch {
      context.save();
      roundedRectPath(
        context,
        resolvedLayout.cardX,
        resolvedLayout.cardY,
        resolvedLayout.cardWidth,
        resolvedLayout.cardHeight,
        resolvedLayout.cardRadius
      );
      context.fillStyle = resolvedLayout.cardFillColor;
      context.fill();
      if (resolvedLayout.cardBorderWidth > 0) {
        context.lineWidth = resolvedLayout.cardBorderWidth;
        context.strokeStyle = resolvedLayout.cardBorderColor;
        context.stroke();
      }
      context.restore();
    }
  } else {
    context.save();
    roundedRectPath(
      context,
      resolvedLayout.cardX,
      resolvedLayout.cardY,
      resolvedLayout.cardWidth,
      resolvedLayout.cardHeight,
      resolvedLayout.cardRadius
    );
    context.fillStyle = resolvedLayout.cardFillColor;
    context.fill();
    if (resolvedLayout.cardBorderWidth > 0) {
      context.lineWidth = resolvedLayout.cardBorderWidth;
      context.strokeStyle = resolvedLayout.cardBorderColor;
      context.stroke();
    }
    context.restore();
  }

  if (resolvedLayout.logoDataUrl) {
    try {
      const logoImage = await loadImage(resolvedLayout.logoDataUrl, "Unable to render logo image.");
      context.drawImage(
        logoImage,
        resolvedLayout.logoX,
        resolvedLayout.logoY,
        resolvedLayout.logoWidth,
        resolvedLayout.logoHeight
      );
    } catch {
      // Ignore logo rendering failures to keep card generation resilient.
    }
  }

  if (options.qrDataUrl) {
    const qrImage = await loadImage(options.qrDataUrl, "Unable to render QR image.");
    context.imageSmoothingEnabled = false;
    context.drawImage(qrImage, resolvedLayout.qrX, resolvedLayout.qrY, resolvedLayout.qrSize, resolvedLayout.qrSize);
    if (resolvedLayout.qrBorderWidth > 0) {
      context.lineWidth = resolvedLayout.qrBorderWidth;
      context.strokeStyle = resolvedLayout.qrBorderColor;
      context.strokeRect(resolvedLayout.qrX, resolvedLayout.qrY, resolvedLayout.qrSize, resolvedLayout.qrSize);
    }
  } else {
    drawQrPlaceholder(context, resolvedLayout);
  }

  if (showData) {
    const textAreaRight = Math.min(resolvedLayout.canvasWidth - 20, resolvedLayout.cardX + resolvedLayout.cardWidth - 24);
    const textAreaWidth = Math.max(80, textAreaRight - resolvedLayout.textX);
    const cardBottomBaseline = resolvedLayout.cardY + resolvedLayout.cardHeight - 20;

    context.fillStyle = resolvedLayout.nameColor;
    context.font = `700 ${resolvedLayout.nameFontSize}px Segoe UI, Arial, sans-serif`;
    const nameLineHeight = Math.max(18, Math.round(resolvedLayout.nameFontSize * 1.08));
    const reservedBranchHeight = Math.max(18, Math.round(resolvedLayout.branchFontSize * 1.1));
    const maxNameBottomBaseline = cardBottomBaseline - reservedBranchHeight - 8;
    const maxNameLines = Math.max(1, Math.floor((maxNameBottomBaseline - resolvedLayout.nameY) / nameLineHeight) + 1);
    const nameLines = wrapTextToLines(context, options.voterName?.trim() || "-", textAreaWidth, maxNameLines);
    nameLines.forEach((line, index) => {
      context.fillText(line, resolvedLayout.textX, resolvedLayout.nameY + index * nameLineHeight);
    });
    const lastNameBaseline = resolvedLayout.nameY + (nameLines.length - 1) * nameLineHeight;

    context.fillStyle = resolvedLayout.branchColor;
    context.font = `500 ${resolvedLayout.branchFontSize}px Segoe UI, Arial, sans-serif`;
    const branchValue = trimTextToWidth(context, options.branch?.trim() || "-", textAreaWidth);
    const minBranchBaseline = lastNameBaseline + Math.max(16, Math.round(resolvedLayout.branchFontSize * 0.9));
    const maxBranchBaseline = cardBottomBaseline;
    const branchBaseline = Math.min(maxBranchBaseline, Math.max(resolvedLayout.branchY, minBranchBaseline));
    context.fillText(branchValue, resolvedLayout.textX, branchBaseline);
  } else {
    context.fillStyle = "#e5e7eb";
    const textAreaRight = Math.min(resolvedLayout.canvasWidth - 20, resolvedLayout.cardX + resolvedLayout.cardWidth - 24);
    const textAreaWidth = Math.max(80, textAreaRight - resolvedLayout.textX);
    const nameBlockHeight = Math.max(20, Math.round(resolvedLayout.nameFontSize * 0.84));
    const branchBlockHeight = Math.max(18, Math.round(resolvedLayout.branchFontSize * 0.84));
    context.fillRect(
      resolvedLayout.textX,
      resolvedLayout.nameY - nameBlockHeight,
      Math.min(textAreaWidth, Math.max(180, Math.round(resolvedLayout.nameFontSize * 6.35))),
      nameBlockHeight + 2
    );
    context.fillRect(
      resolvedLayout.textX,
      resolvedLayout.nameY + 8,
      Math.min(textAreaWidth, Math.max(140, Math.round(resolvedLayout.nameFontSize * 3.8))),
      nameBlockHeight + 2
    );
    context.fillRect(
      resolvedLayout.textX,
      resolvedLayout.branchY - branchBlockHeight,
      Math.min(textAreaWidth, Math.max(140, Math.round(resolvedLayout.branchFontSize * 6.2))),
      branchBlockHeight + 2
    );
  }

  if (resolvedLayout.footerText.trim() !== "") {
    context.fillStyle = resolvedLayout.footerColor;
    context.font = `500 ${Math.max(18, Math.round(resolvedLayout.branchFontSize * 0.88))}px Segoe UI, Arial, sans-serif`;
    context.fillText(resolvedLayout.footerText, resolvedLayout.textX, resolvedLayout.footerY);
  }

  return canvas;
}

interface BuildVoterQrCardOptions {
  qrDataUrl: string;
  voterName: string;
  branch: string;
  layout?: Partial<VoterCardTemplateLayout>;
}

export async function buildVoterQrCardPng(options: BuildVoterQrCardOptions) {
  const canvas = await buildVoterQrCardCanvas({
    qrDataUrl: options.qrDataUrl,
    voterName: options.voterName,
    branch: options.branch,
    layout: options.layout,
    showData: true,
  });
  return canvas.toDataURL("image/png");
}

export async function buildVoterQrCardBlob(options: BuildVoterQrCardOptions) {
  const canvas = await buildVoterQrCardCanvas({
    qrDataUrl: options.qrDataUrl,
    voterName: options.voterName,
    branch: options.branch,
    layout: options.layout,
    showData: true,
  });
  return canvasToPngBlob(canvas);
}
