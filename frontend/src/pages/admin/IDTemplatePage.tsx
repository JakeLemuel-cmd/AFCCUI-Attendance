import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT,
  buildVoterQrCardCanvas,
  deriveTemplateLayoutFromReferenceImage,
  getStoredVoterCardTemplateLayout,
  resetVoterCardTemplateLayout,
  sanitizeVoterCardTemplateLayout,
  saveVoterCardTemplateLayout,
  type VoterCardTemplateLayout,
} from "@/lib/voterCardTemplate";

type PositionFieldKey =
  | "logoX"
  | "logoY"
  | "cardX"
  | "cardY"
  | "qrX"
  | "qrY"
  | "textX"
  | "nameY"
  | "branchY";

type SizeFieldKey =
  | "cardWidth"
  | "cardHeight"
  | "cardRadius"
  | "qrSize"
  | "logoWidth"
  | "logoHeight"
  | "nameFontSize"
  | "branchFontSize";
type DesignNumberFieldKey =
  | "headerHeight"
  | "headerTextX"
  | "headerTextY"
  | "footerY"
  | "cardBorderWidth"
  | "qrBorderWidth";
type NumberFieldKey = PositionFieldKey | SizeFieldKey | DesignNumberFieldKey;
type ColorFieldKey =
  | "backgroundColor"
  | "headerColor"
  | "headerTextColor"
  | "cardFillColor"
  | "cardBorderColor"
  | "qrBorderColor"
  | "nameColor"
  | "branchColor"
  | "footerColor";
type DragHandleId = "logo" | "card" | "qr" | "name" | "branch";

const NUMBER_LIMITS: Record<NumberFieldKey, { min: number; max: number }> = {
  logoX: { min: 20, max: 1800 },
  logoY: { min: 10, max: 1300 },
  cardX: { min: 20, max: 1700 },
  cardY: { min: 20, max: 1300 },
  qrX: { min: 20, max: 1800 },
  qrY: { min: 20, max: 1300 },
  textX: { min: 20, max: 1800 },
  nameY: { min: 20, max: 1300 },
  branchY: { min: 20, max: 1300 },
  cardWidth: { min: 300, max: 1700 },
  cardHeight: { min: 220, max: 1200 },
  cardRadius: { min: 0, max: 200 },
  qrSize: { min: 120, max: 900 },
  logoWidth: { min: 60, max: 900 },
  logoHeight: { min: 30, max: 600 },
  nameFontSize: { min: 16, max: 140 },
  branchFontSize: { min: 14, max: 120 },
  headerHeight: { min: 70, max: 220 },
  headerTextX: { min: 20, max: 1500 },
  headerTextY: { min: 30, max: 500 },
  footerY: { min: 20, max: 1300 },
  cardBorderWidth: { min: 0, max: 20 },
  qrBorderWidth: { min: 0, max: 12 },
};

const COLOR_FIELDS: Array<{ key: ColorFieldKey; label: string }> = [
  { key: "backgroundColor", label: "Canvas Background" },
  { key: "headerColor", label: "Header Background" },
  { key: "headerTextColor", label: "Header Text" },
  { key: "cardFillColor", label: "Card Background" },
  { key: "cardBorderColor", label: "Card Border" },
  { key: "qrBorderColor", label: "QR Border" },
  { key: "nameColor", label: "Name Text" },
  { key: "branchColor", label: "Branch Text" },
  { key: "footerColor", label: "Footer Text" },
];

interface DragHandle {
  id: DragHandleId;
  label: string;
  xKey: PositionFieldKey;
  yKey: PositionFieldKey;
  widthKey?: SizeFieldKey;
  heightKey?: SizeFieldKey;
  movable?: boolean;
}

const DRAG_HANDLES: DragHandle[] = [
  { id: "logo", label: "Logo", xKey: "logoX", yKey: "logoY", widthKey: "logoWidth", heightKey: "logoHeight" },
  { id: "card", label: "Card", xKey: "cardX", yKey: "cardY", widthKey: "cardWidth", heightKey: "cardHeight", movable: false },
  { id: "qr", label: "QR", xKey: "qrX", yKey: "qrY", widthKey: "qrSize", heightKey: "qrSize" },
  { id: "name", label: "Name", xKey: "textX", yKey: "nameY" },
  { id: "branch", label: "Branch", xKey: "textX", yKey: "branchY" },
];

const HANDLE_STYLES: Record<
  DragHandleId,
  {
    outline: string;
    badge: string;
    point: string;
    active: string;
  }
> = {
  logo: {
    outline: "border-cyan-500/80 bg-cyan-500/10",
    badge: "bg-cyan-600 text-white",
    point: "border-cyan-500 bg-cyan-50 text-cyan-700",
    active: "ring-cyan-300",
  },
  card: {
    outline: "border-emerald-500/80 bg-emerald-500/10",
    badge: "bg-emerald-600 text-white",
    point: "border-emerald-500 bg-emerald-50 text-emerald-700",
    active: "ring-emerald-300",
  },
  qr: {
    outline: "border-sky-500/80 bg-sky-500/10",
    badge: "bg-sky-600 text-white",
    point: "border-sky-500 bg-sky-50 text-sky-700",
    active: "ring-sky-300",
  },
  name: {
    outline: "border-amber-500/80 bg-amber-500/10",
    badge: "bg-amber-600 text-white",
    point: "border-amber-500 bg-amber-50 text-amber-700",
    active: "ring-amber-300",
  },
  branch: {
    outline: "border-violet-500/80 bg-violet-500/10",
    badge: "bg-violet-600 text-white",
    point: "border-violet-500 bg-violet-50 text-violet-700",
    active: "ring-violet-300",
  },
};

interface DragSession {
  mode: "move" | "resize";
  handleId: DragHandleId;
  pointerId: number;
  xKey: PositionFieldKey;
  yKey: PositionFieldKey;
  widthKey?: SizeFieldKey;
  heightKey?: SizeFieldKey;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
  startClientX: number;
  startClientY: number;
  canvasRect: DOMRect;
  canvasWidth: number;
  canvasHeight: number;
}

function clampNumberField(key: NumberFieldKey, value: number) {
  const limits = NUMBER_LIMITS[key];
  return Math.max(limits.min, Math.min(limits.max, value));
}

function toPercent(value: number, total: number) {
  return `${(value / Math.max(1, total)) * 100}%`;
}

function toColorPickerValue(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function IDTemplatePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const cardImageInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const [savedTemplate, setSavedTemplate] = useState<VoterCardTemplateLayout>(() => getStoredVoterCardTemplateLayout());
  const [draftTemplate, setDraftTemplate] = useState<VoterCardTemplateLayout>(() => getStoredVoterCardTemplateLayout());
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImportedTemplate, setPendingImportedTemplate] = useState<VoterCardTemplateLayout | null>(null);
  const [activeHandleId, setActiveHandleId] = useState<DragHandleId | null>(null);
  const [showColorPalette, setShowColorPalette] = useState(false);

  const templateForPreview = editing ? draftTemplate : pendingImportedTemplate ?? savedTemplate;
  const previewName = "Sample Name";
  const previewBranch = "Sample Branch";

  useEffect(() => {
    let cancelled = false;

    const drawPreview = async () => {
      const targetCanvas = canvasRef.current;
      if (!targetCanvas) {
        return;
      }

      const previewCanvas = await buildVoterQrCardCanvas({
        layout: templateForPreview,
        voterName: previewName,
        branch: previewBranch,
        showData: true,
      });

      if (cancelled || !canvasRef.current) {
        return;
      }

      canvasRef.current.width = previewCanvas.width;
      canvasRef.current.height = previewCanvas.height;
      const context = canvasRef.current.getContext("2d");
      if (!context) {
        return;
      }

      context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      context.drawImage(previewCanvas, 0, 0);
    };

    void drawPreview();

    return () => {
      cancelled = true;
    };
  }, [templateForPreview, previewBranch, previewName]);

  const updateNumberField = (key: NumberFieldKey, value: string) => {
    if (value.trim() === "") {
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    setDraftTemplate((current) => ({
      ...current,
      [key]: clampNumberField(key, parsed),
    }));
  };

  const updateColorField = (key: ColorFieldKey, value: string) => {
    setDraftTemplate((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const startEditing = () => {
    setDraftTemplate(savedTemplate);
    setEditing(true);
    setShowColorPalette(false);
    setNotice(null);
  };

  const openLogoPicker = () => {
    logoInputRef.current?.click();
  };

  const openCardImagePicker = () => {
    cardImageInputRef.current?.click();
  };

  const handleTemplateImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const isJson = file.type === "application/json" || /\.json$/i.test(file.name);
    const isImage = file.type === "image/png" || file.type === "image/jpeg" || /\.(png|jpe?g)$/i.test(file.name);

    if (isJson) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string" || reader.result.trim() === "") {
          setNotice("Unable to read template file.");
          event.target.value = "";
          return;
        }

        try {
          const parsed = JSON.parse(reader.result) as Partial<VoterCardTemplateLayout>;
          const sanitized = sanitizeVoterCardTemplateLayout(parsed);
          setPendingImportedTemplate(sanitized);
          setNotice("Template imported. Choose Use or Discard.");
        } catch {
          setNotice("Invalid template file. Please import a valid JSON template.");
        } finally {
          event.target.value = "";
        }
      };

      reader.onerror = () => {
        setNotice("Unable to read template file.");
        event.target.value = "";
      };

      reader.readAsText(file);
      return;
    }

    if (isImage) {
      setNotice("Scanning template image...");
      const reader = new FileReader();
      reader.onload = async () => {
        if (typeof reader.result !== "string" || reader.result.trim() === "") {
          setNotice("Unable to read template image.");
          event.target.value = "";
          return;
        }

        try {
          const detectedLayout = await deriveTemplateLayoutFromReferenceImage(savedTemplate, reader.result);
          setPendingImportedTemplate(detectedLayout);
          setNotice("Template image imported with detected QR/text positions. Choose Use or Discard.");
        } catch {
          const sanitized = sanitizeVoterCardTemplateLayout({
            ...savedTemplate,
            cardTemplateImageDataUrl: reader.result,
          });
          setPendingImportedTemplate(sanitized);
          setNotice("Template image imported. Could not auto-detect all positions. Choose Use or Discard.");
        }
        event.target.value = "";
      };

      reader.onerror = () => {
        setNotice("Unable to read template image.");
        event.target.value = "";
      };

      reader.readAsDataURL(file);
      return;
    }

    setNotice("Unsupported file type. Import a .json, .png, .jpg, or .jpeg file.");
    event.target.value = "";
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file for the logo.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || reader.result.trim() === "") {
        setNotice("Unable to load the selected logo file.");
        event.target.value = "";
        return;
      }

      setDraftTemplate((current) => ({
        ...current,
        logoDataUrl: reader.result as string,
      }));
      setNotice("Logo uploaded. Drag the Logo overlay on the canvas to place it.");
      event.target.value = "";
    };
    reader.onerror = () => {
      setNotice("Unable to load the selected logo file.");
      event.target.value = "";
    };

    reader.readAsDataURL(file);
  };

  const handleCardBackgroundUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file for the card background.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || reader.result.trim() === "") {
        setNotice("Unable to load the selected card background image.");
        event.target.value = "";
        return;
      }

      setDraftTemplate((current) => ({
        ...current,
        cardTemplateImageDataUrl: reader.result as string,
      }));
      setNotice("Card background image uploaded.");
      event.target.value = "";
    };
    reader.onerror = () => {
      setNotice("Unable to load the selected card background image.");
      event.target.value = "";
    };

    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setDraftTemplate((current) => ({
      ...current,
      logoDataUrl: "",
    }));
    setNotice("Logo removed from the template.");
  };

  const removeCardBackground = () => {
    setDraftTemplate((current) => ({
      ...current,
      cardTemplateImageDataUrl: "",
    }));
    setNotice("Card background image removed.");
  };

  const cancelEditing = () => {
    dragSessionRef.current = null;
    setActiveHandleId(null);
    setDraftTemplate(savedTemplate);
    setEditing(false);
  };

  const saveTemplate = () => {
    const sanitized = sanitizeVoterCardTemplateLayout(draftTemplate);
    saveVoterCardTemplateLayout(sanitized);
    setSavedTemplate(sanitized);
    setDraftTemplate(sanitized);
    setPendingImportedTemplate(null);
    dragSessionRef.current = null;
    setActiveHandleId(null);
    setEditing(false);
    setNotice("Template updated. New voter QR cards will use this layout.");
  };

  const restoreDefaults = () => {
    resetVoterCardTemplateLayout();
    setSavedTemplate(DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT);
    setDraftTemplate(DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT);
    setPendingImportedTemplate(null);
    dragSessionRef.current = null;
    setActiveHandleId(null);
    setEditing(false);
    setNotice("Template reset to the default layout.");
  };

  const applyImportedTemplate = () => {
    if (!pendingImportedTemplate) {
      return;
    }

    saveVoterCardTemplateLayout(pendingImportedTemplate);
    setSavedTemplate(pendingImportedTemplate);
    setDraftTemplate(pendingImportedTemplate);
    setPendingImportedTemplate(null);
    setNotice("Imported template applied.");
  };

  const discardImportedTemplate = () => {
    if (!pendingImportedTemplate) {
      return;
    }

    setPendingImportedTemplate(null);
    setNotice("Imported template discarded.");
  };

  const startDrag = (handle: DragHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing || handle.movable === false) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    event.preventDefault();

    dragSessionRef.current = {
      mode: "move",
      handleId: handle.id,
      pointerId: event.pointerId,
      xKey: handle.xKey,
      yKey: handle.yKey,
      startX: draftTemplate[handle.xKey],
      startY: draftTemplate[handle.yKey],
      startClientX: event.clientX,
      startClientY: event.clientY,
      canvasRect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };

    setActiveHandleId(handle.id);
    setNotice(null);
  };

  const startResize = (handle: DragHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing || !handle.widthKey || !handle.heightKey) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragSessionRef.current = {
      mode: "resize",
      handleId: handle.id,
      pointerId: event.pointerId,
      xKey: handle.xKey,
      yKey: handle.yKey,
      widthKey: handle.widthKey,
      heightKey: handle.heightKey,
      startX: draftTemplate[handle.xKey],
      startY: draftTemplate[handle.yKey],
      startWidth: draftTemplate[handle.widthKey],
      startHeight: draftTemplate[handle.heightKey],
      startClientX: event.clientX,
      startClientY: event.clientY,
      canvasRect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };

    setActiveHandleId(handle.id);
    setNotice(null);
  };

  useEffect(() => {
    if (!activeHandleId) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragSession = dragSessionRef.current;
      if (!dragSession || event.pointerId !== dragSession.pointerId) {
        return;
      }

      event.preventDefault();

      const deltaX = ((event.clientX - dragSession.startClientX) / dragSession.canvasRect.width) * dragSession.canvasWidth;
      const deltaY = ((event.clientY - dragSession.startClientY) / dragSession.canvasRect.height) * dragSession.canvasHeight;

      if (dragSession.mode === "resize" && dragSession.widthKey && dragSession.heightKey) {
        const widthKey = dragSession.widthKey;
        const heightKey = dragSession.heightKey;

        setDraftTemplate((current) => {
          if (typeof dragSession.startWidth !== "number" || typeof dragSession.startHeight !== "number") {
            return current;
          }

          if (widthKey === heightKey) {
            const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
            const nextSize = clampNumberField(widthKey, Math.round(dragSession.startWidth + delta));
            if (current[widthKey] === nextSize) {
              return current;
            }

            return {
              ...current,
              [widthKey]: nextSize,
            };
          }

          const nextWidth = clampNumberField(widthKey, Math.round(dragSession.startWidth + deltaX));
          const nextHeight = clampNumberField(heightKey, Math.round(dragSession.startHeight + deltaY));
          if (current[widthKey] === nextWidth && current[heightKey] === nextHeight) {
            return current;
          }

          return {
            ...current,
            [widthKey]: nextWidth,
            [heightKey]: nextHeight,
          };
        });

        return;
      }

      const nextX = clampNumberField(dragSession.xKey, Math.round(dragSession.startX + deltaX));
      const nextY = clampNumberField(dragSession.yKey, Math.round(dragSession.startY + deltaY));
      setDraftTemplate((current) => {
        if (current[dragSession.xKey] === nextX && current[dragSession.yKey] === nextY) {
          return current;
        }

        return {
          ...current,
          [dragSession.xKey]: nextX,
          [dragSession.yKey]: nextY,
        };
      });
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const dragSession = dragSessionRef.current;
      if (!dragSession || event.pointerId !== dragSession.pointerId) {
        return;
      }

      dragSessionRef.current = null;
      setActiveHandleId(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [activeHandleId]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 md:flex md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>ID Template</CardTitle>
            <CardDescription>
              Edit and preview the attendance QR card layout. Saved changes are used when generating attendance QR cards.
            </CardDescription>
          </div>
          {!editing ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={templateInputRef}
                type="file"
                accept="application/json,.json,image/png,.png,image/jpeg,.jpg,.jpeg"
                className="hidden"
                onChange={handleTemplateImport}
              />
              <Button
                type="button"
                className="inline-flex items-center gap-2"
                onClick={startEditing}
                disabled={Boolean(pendingImportedTemplate)}
              >
                <Pencil className="h-4 w-4" />
                Edit Layout
              </Button>
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {pendingImportedTemplate && !editing ? (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p>Imported template loaded in preview. Use this template or discard it?</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={applyImportedTemplate}>
                  Use
                </Button>
                <Button type="button" variant="outline" onClick={discardImportedTemplate}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {editing ? (
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">Canvas Editor</h3>
              <p className="text-sm text-muted-foreground">
                Drag the overlays on the preview canvas to move each element, similar to a Canva-style editor.
              </p>
              <p className="text-sm text-muted-foreground">
                Resize card, QR, and logo by dragging the bottom-right corner handle.
              </p>

              <div className="rounded-lg border bg-muted/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                  onClick={() => setShowColorPalette((current) => !current)}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Color Palette
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      showColorPalette ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showColorPalette ? (
                  <div className="grid gap-3 border-t px-3 pb-3 pt-2 md:grid-cols-3">
                    {COLOR_FIELDS.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <Label htmlFor={`template-${field.key}`}>{field.label}</Label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`template-${field.key}`}
                            type="color"
                            value={toColorPickerValue(
                              draftTemplate[field.key],
                              DEFAULT_VOTER_CARD_TEMPLATE_LAYOUT[field.key]
                            )}
                            onChange={(event) => updateColorField(field.key, event.target.value)}
                            className="h-10 w-12 cursor-pointer rounded border bg-white p-1"
                          />
                          <Input
                            value={draftTemplate[field.key]}
                            onChange={(event) => updateColorField(field.key, event.target.value)}
                            placeholder="#000000"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <input
                  ref={cardImageInputRef}
                  type="file"
                  accept="image/png,.png,image/jpeg,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleCardBackgroundUpload}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="inline-flex items-center gap-2"
                    onClick={openCardImagePicker}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Upload Card Background
                  </Button>
                  {draftTemplate.cardTemplateImageDataUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="inline-flex items-center gap-2"
                      onClick={removeCardBackground}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove Card Background
                    </Button>
                  ) : null}
                </div>
                {draftTemplate.cardTemplateImageDataUrl ? (
                  <img
                    src={draftTemplate.cardTemplateImageDataUrl}
                    alt="Card background preview"
                    className="h-20 max-w-64 rounded border bg-white object-cover p-1"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">No card background image uploaded.</p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="inline-flex items-center gap-2" onClick={openLogoPicker}>
                    <ImagePlus className="h-4 w-4" />
                    Upload Logo
                  </Button>
                  {draftTemplate.logoDataUrl ? (
                    <Button type="button" variant="ghost" className="inline-flex items-center gap-2" onClick={removeLogo}>
                      <Trash2 className="h-4 w-4" />
                      Remove Logo
                    </Button>
                  ) : null}
                </div>
                {draftTemplate.logoDataUrl ? (
                  <img
                    src={draftTemplate.logoDataUrl}
                    alt="Template logo preview"
                    className="h-12 max-w-48 rounded border bg-white object-contain p-1"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">No logo uploaded yet.</p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="template-cardRadius">Card Radius</Label>
                  <Input
                    key={`cardRadius-${draftTemplate.cardRadius}`}
                    id="template-cardRadius"
                    type="number"
                    min={NUMBER_LIMITS.cardRadius.min}
                    max={NUMBER_LIMITS.cardRadius.max}
                    step={1}
                    defaultValue={draftTemplate.cardRadius}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.cardRadius);
                        return;
                      }

                      updateNumberField("cardRadius", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-cardBorderWidth">Card Border Width</Label>
                  <Input
                    key={`cardBorderWidth-${draftTemplate.cardBorderWidth}`}
                    id="template-cardBorderWidth"
                    type="number"
                    min={NUMBER_LIMITS.cardBorderWidth.min}
                    max={NUMBER_LIMITS.cardBorderWidth.max}
                    step={1}
                    defaultValue={draftTemplate.cardBorderWidth}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.cardBorderWidth);
                        return;
                      }

                      updateNumberField("cardBorderWidth", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-qrBorderWidth">QR Border Width</Label>
                  <Input
                    key={`qrBorderWidth-${draftTemplate.qrBorderWidth}`}
                    id="template-qrBorderWidth"
                    type="number"
                    min={NUMBER_LIMITS.qrBorderWidth.min}
                    max={NUMBER_LIMITS.qrBorderWidth.max}
                    step={1}
                    defaultValue={draftTemplate.qrBorderWidth}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.qrBorderWidth);
                        return;
                      }

                      updateNumberField("qrBorderWidth", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-nameFontSize">Name Size</Label>
                  <Input
                    key={`nameFontSize-${draftTemplate.nameFontSize}`}
                    id="template-nameFontSize"
                    type="number"
                    min={NUMBER_LIMITS.nameFontSize.min}
                    max={NUMBER_LIMITS.nameFontSize.max}
                    step={1}
                    defaultValue={draftTemplate.nameFontSize}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.nameFontSize);
                        return;
                      }

                      updateNumberField("nameFontSize", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-branchFontSize">Branch Size</Label>
                  <Input
                    key={`branchFontSize-${draftTemplate.branchFontSize}`}
                    id="template-branchFontSize"
                    type="number"
                    min={NUMBER_LIMITS.branchFontSize.min}
                    max={NUMBER_LIMITS.branchFontSize.max}
                    step={1}
                    defaultValue={draftTemplate.branchFontSize}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.branchFontSize);
                        return;
                      }

                      updateNumberField("branchFontSize", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-headerHeight">Header Height</Label>
                  <Input
                    key={`headerHeight-${draftTemplate.headerHeight}`}
                    id="template-headerHeight"
                    type="number"
                    min={NUMBER_LIMITS.headerHeight.min}
                    max={NUMBER_LIMITS.headerHeight.max}
                    step={1}
                    defaultValue={draftTemplate.headerHeight}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.headerHeight);
                        return;
                      }

                      updateNumberField("headerHeight", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-headerTextX">Header Text X</Label>
                  <Input
                    key={`headerTextX-${draftTemplate.headerTextX}`}
                    id="template-headerTextX"
                    type="number"
                    min={NUMBER_LIMITS.headerTextX.min}
                    max={NUMBER_LIMITS.headerTextX.max}
                    step={1}
                    defaultValue={draftTemplate.headerTextX}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.headerTextX);
                        return;
                      }

                      updateNumberField("headerTextX", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-headerTextY">Header Text Y</Label>
                  <Input
                    key={`headerTextY-${draftTemplate.headerTextY}`}
                    id="template-headerTextY"
                    type="number"
                    min={NUMBER_LIMITS.headerTextY.min}
                    max={NUMBER_LIMITS.headerTextY.max}
                    step={1}
                    defaultValue={draftTemplate.headerTextY}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.headerTextY);
                        return;
                      }

                      updateNumberField("headerTextY", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="template-footerY">Footer Y</Label>
                  <Input
                    key={`footerY-${draftTemplate.footerY}`}
                    id="template-footerY"
                    type="number"
                    min={NUMBER_LIMITS.footerY.min}
                    max={NUMBER_LIMITS.footerY.max}
                    step={1}
                    defaultValue={draftTemplate.footerY}
                    onBlur={(event) => {
                      if (event.target.value.trim() === "") {
                        event.target.value = String(draftTemplate.footerY);
                        return;
                      }

                      updateNumberField("footerY", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={saveTemplate}>
                  Save Template
                </Button>
                <Button type="button" variant="outline" onClick={cancelEditing}>
                  Cancel
                </Button>
                <Button type="button" variant="ghost" onClick={restoreDefaults}>
                  Reset to Default
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" onClick={restoreDefaults}>
                Reset to Default
              </Button>
            </div>
          )}

          <div className="flex justify-center overflow-auto rounded-xl border bg-slate-50 p-4">
            <div className="relative w-full max-w-5xl">
              <canvas ref={canvasRef} className="block w-full rounded-xl border bg-white shadow-sm" />
              {editing ? (
                <div className="pointer-events-none absolute inset-0">
                  {DRAG_HANDLES.filter((handle) => handle.id !== "logo" || draftTemplate.logoDataUrl.trim() !== "").map(
                    (handle) => {
                    const style = HANDLE_STYLES[handle.id];
                    const isActive = activeHandleId === handle.id;
                    const layerClass = handle.id === "card" ? "z-10" : handle.id === "logo" ? "z-30" : "z-20";
                    const left = toPercent(draftTemplate[handle.xKey], draftTemplate.canvasWidth);
                    const top = toPercent(draftTemplate[handle.yKey], draftTemplate.canvasHeight);
                    const ringClass = isActive ? `ring-2 ${style.active}` : "";

                    if (handle.widthKey && handle.heightKey) {
                      const width = toPercent(draftTemplate[handle.widthKey], draftTemplate.canvasWidth);
                      const height = toPercent(draftTemplate[handle.heightKey], draftTemplate.canvasHeight);

                      return (
                        <div key={handle.id} className={`absolute ${layerClass}`} style={{ left, top, width, height }}>
                          <button
                            type="button"
                            className={`h-full w-full rounded-md border-2 border-dashed transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                              handle.movable === false
                                ? "pointer-events-none cursor-default"
                                : "pointer-events-auto cursor-grab active:cursor-grabbing"
                            } ${style.outline} ${ringClass}`}
                            onPointerDown={handle.movable === false ? undefined : (event) => startDrag(handle, event)}
                          >
                            <span
                              className={`absolute -top-8 left-0 rounded px-2 py-1 text-[11px] font-semibold tracking-wide ${style.badge}`}
                            >
                              {handle.label}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Resize ${handle.label}`}
                            className="pointer-events-auto absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize rounded border-2 border-white bg-slate-700 shadow-sm"
                            onPointerDown={(event) => startResize(handle, event)}
                          />
                        </div>
                      );
                    }

                    return (
                      <button
                        key={handle.id}
                        type="button"
                        className={`pointer-events-auto absolute ${layerClass} min-w-16 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 active:cursor-grabbing ${style.point} ${ringClass}`}
                        style={{ left, top }}
                        onPointerDown={(event) => startDrag(handle, event)}
                      >
                        {handle.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
