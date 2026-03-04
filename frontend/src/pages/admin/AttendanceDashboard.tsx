import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { CalendarCheck2, Camera, ChevronDown, Download, Link as LinkIcon, Plus, Trash2, Upload, UserCheck2, UserX, Users } from "lucide-react";
import { exportPresentAttendancesCsv, getAttendances, upsertAttendance } from "@/api/attendance";
import { extractErrorMessage } from "@/api/client";
import { getElections } from "@/api/elections";
import { getVoters } from "@/api/users";
import type { Attendance, ElectionStatus, PaginationMeta, User, UserRole } from "@/api/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionAlert } from "@/components/ui/action-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAttendanceTask } from "@/hooks/useAttendanceTask";
import { cn } from "@/lib/utils";

type ScanValidationTone = "success" | "warning" | "error";

interface ScanValidation {
  tone: ScanValidationTone;
  message: string;
  voterId: string | null;
  at: number;
}

type AttendanceView = "attendance" | "records";

interface AttendanceDashboardProps {
  view?: AttendanceView;
}

const ATTENDANCE_PER_PAGE = 10;

function parseVoterIdFromQr(rawValue: string): string | null {
  const normalized = rawValue
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .trim();

  if (normalized === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const voterId = String(parsed?.voter_id ?? parsed?.voterId ?? "").trim();
    if (voterId !== "") {
      return voterId;
    }
  } catch {
    // Continue with alternate formats.
  }

  try {
    const url = new URL(normalized, window.location.origin);
    const voterId = (url.searchParams.get("voter_id") ?? url.searchParams.get("voterId") ?? "").trim();
    if (voterId !== "") {
      return voterId;
    }
  } catch {
    // Continue with raw query-string fallback.
  }

  const queryStart = normalized.indexOf("?");
  const queryString = queryStart >= 0 ? normalized.slice(queryStart) : normalized;
  const params = new URLSearchParams(queryString.startsWith("?") ? queryString : `?${queryString}`);
  const queryVoterId = (params.get("voter_id") ?? params.get("voterId") ?? "").trim();
  if (queryVoterId !== "") {
    return queryVoterId;
  }

  const inlineVoterId = normalized.match(/voter[_\s-]?id\s*[:=]\s*["']?([^"'\s,;|]+)["']?/i)?.[1]?.trim();
  if (inlineVoterId) {
    return inlineVoterId;
  }

  return null;
}

function formatUserRole(role: UserRole): string {
  return role
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function AttendanceDashboard({ view = "attendance" }: AttendanceDashboardProps) {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [recordsMeta, setRecordsMeta] = useState<PaginationMeta | null>(null);
  const [recordsPage, setRecordsPage] = useState(1);
  const [summary, setSummary] = useState({ total: 0, present: 0, absent: 0 });
  const [loading, setLoading] = useState(false);
  const [activeElectionId, setActiveElectionId] = useState<number | null>(null);
  const [activeElectionLabel, setActiveElectionLabel] = useState<string>("No election selected");
  const [activeElectionStatus, setActiveElectionStatus] = useState<ElectionStatus | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "warning"; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addAttendanceOpen, setAddAttendanceOpen] = useState(false);
  const [selectedVoter, setSelectedVoter] = useState<{ voterId: string; label: string } | null>(null);
  const [voterDropdownOpen, setVoterDropdownOpen] = useState(false);
  const [voterSearch, setVoterSearch] = useState("");
  const [voterOptions, setVoterOptions] = useState<User[]>([]);
  const [loadingVoterOptions, setLoadingVoterOptions] = useState(false);
  const [addingAttendance, setAddingAttendance] = useState(false);
  const [addAttendanceError, setAddAttendanceError] = useState<string | null>(null);
  const [addAttendanceLookupError, setAddAttendanceLookupError] = useState<string | null>(null);
  const [deleteAttendanceOpen, setDeleteAttendanceOpen] = useState(false);
  const [deletingAttendance, setDeletingAttendance] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [deleteAttendanceError, setDeleteAttendanceError] = useState<string | null>(null);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState("Allow camera access and point to voter QR code.");
  const [scanValidation, setScanValidation] = useState<ScanValidation | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const protectedAttendanceEmail = "voter@voting.local";
  const { startImport, startDelete, action: attendanceTaskAction, status: attendanceTaskStatus, progress: attendanceTaskProgress } =
    useAttendanceTask();
  const importingAttendance = attendanceTaskAction === "import" && (attendanceTaskStatus === "uploading" || attendanceTaskStatus === "processing");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const voterDropdownRef = useRef<HTMLDivElement | null>(null);
  const voterSearchInputRef = useRef<HTMLInputElement | null>(null);
  const qrUploadInputRef = useRef<HTMLInputElement | null>(null);
  const attendanceImportInputRef = useRef<HTMLInputElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ voterId: string; at: number } | null>(null);

  const loadAttendances = useCallback(async (electionId: number, page = 1) => {
    try {
      setLoading(true);
      const response = await getAttendances({
        election_id: electionId,
        status: view === "attendance" ? "present" : undefined,
        page,
        per_page: ATTENDANCE_PER_PAGE,
      });
      setRecords(response.data);
      setRecordsMeta(response.meta);
      setRecordsPage(response.meta.current_page);
      setSummary(response.summary);
    } catch (loadError) {
      setNotice({
        tone: "error",
        message: extractErrorMessage(loadError),
      });
    } finally {
      setLoading(false);
    }
  }, [view]);

  const buildAttendanceLink = useCallback((electionId: number) => {
    const origin = window.location.origin;
    return `${origin}/attendance-access/${electionId}`;
  }, []);

  const stopScanner = useCallback(() => {
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        // Ignore stop errors during cleanup.
      }
      zxingControlsRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleScannedVoter = useCallback(
    async (voterId: string) => {
      if (!activeElectionId) {
        const message = "No election selected for attendance scanning.";
        setNotice({
          tone: "error",
          message,
        });
        setScanValidation({
          tone: "error",
          message,
          voterId,
          at: Date.now(),
        });
        return;
      }

      try {
        const response = await upsertAttendance({
          election_id: activeElectionId,
          voter_id: voterId,
          status: "present",
        });

        setNotice({
          tone: "success",
          message: response.message,
        });
        setScanError(null);
        setScanValidation({
          tone: "success",
          message: response.message,
          voterId,
          at: Date.now(),
        });
        await loadAttendances(activeElectionId, recordsPage);
      } catch (scanSubmitError) {
        const message = extractErrorMessage(scanSubmitError);
        const lowerMessage = message.toLowerCase();
        const tone: ScanValidationTone =
          lowerMessage.includes("already") && lowerMessage.includes("present") ? "warning" : "error";
        setNotice({
          tone,
          message,
        });
        setScanValidation({
          tone,
          message,
          voterId,
          at: Date.now(),
        });
      }
    },
    [activeElectionId, loadAttendances, recordsPage]
  );

  const handleExportPresent = useCallback(async () => {
    if (!activeElectionId) {
      setNotice({
        tone: "warning",
        message: "No election selected for export.",
      });
      return;
    }

    try {
      setExporting(true);
      const exportedCount = await exportPresentAttendancesCsv(activeElectionId);
      setNotice({
        tone: exportedCount > 0 ? "success" : "warning",
        message:
          exportedCount > 0
            ? `Exported ${exportedCount} present attendance record(s).`
            : "No present attendance records to export.",
      });
    } catch (exportError) {
      setNotice({
        tone: "error",
        message: extractErrorMessage(exportError),
      });
    } finally {
      setExporting(false);
    }
  }, [activeElectionId]);

  const handleImportAttendance = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (files.length === 0) {
        return;
      }

      if (!activeElectionId) {
        setNotice({
          tone: "warning",
          message: "No election selected for attendance import.",
        });
        return;
      }

      try {
        let importedFileCount = 0;
        let totalCreated = 0;
        let totalUpdated = 0;
        let totalProcessed = 0;
        let totalSkipped = 0;
        let firstCsvIssue: string | null = null;
        let firstFailedFileError: string | null = null;

        for (const file of files) {
          try {
            const response = await startImport(file, activeElectionId);
            importedFileCount += 1;
            totalCreated += response.meta.created;
            totalUpdated += response.meta.updated;
            totalProcessed += response.meta.total_processed;
            totalSkipped += response.meta.skipped ?? 0;

            if (!firstCsvIssue && response.errors?.[0]) {
              firstCsvIssue = `line ${response.errors[0].line} - ${response.errors[0].message}`;
            }
          } catch (importError) {
            if (!firstFailedFileError) {
              firstFailedFileError = `${file.name}: ${extractErrorMessage(importError)}`;
            }
          }
        }

        if (importedFileCount > 0) {
          await loadAttendances(activeElectionId, recordsPage);
        }

        if (importedFileCount === 0) {
          setNotice({
            tone: "error",
            message: firstFailedFileError ?? "No files were imported.",
          });
          return;
        }

        const summaryPrefix =
          files.length > 1
            ? `Imported ${importedFileCount}/${files.length} file(s).`
            : "Attendance import completed.";
        const firstIssueText = firstCsvIssue ? ` First issue: ${firstCsvIssue}.` : "";
        const failureText = firstFailedFileError ? ` First failed file: ${firstFailedFileError}` : "";
        const tone: "success" | "warning" = totalSkipped > 0 || importedFileCount < files.length ? "warning" : "success";

        setNotice({
          tone,
          message: `${summaryPrefix} Processed: ${totalProcessed}. Updated: ${totalUpdated}. Created: ${totalCreated}. Skipped: ${totalSkipped}.${firstIssueText}${failureText}`,
        });
      } catch (importError) {
        setNotice({
          tone: "error",
          message: extractErrorMessage(importError),
        });
      }
    },
    [activeElectionId, loadAttendances, recordsPage, startImport]
  );

  const loadVoterOptions = useCallback(
    async (searchTerm: string) => {
      try {
        setLoadingVoterOptions(true);
        setAddAttendanceLookupError(null);

        const response = await getVoters(1, 200, searchTerm, activeElectionId ?? undefined);
        setVoterOptions(
          response.data.filter((voter) => {
            const email = voter.email ? voter.email.trim().toLowerCase() : "";
            return Boolean(voter.voter_id) && email !== protectedAttendanceEmail;
          })
        );
      } catch (loadVotersError) {
        setAddAttendanceLookupError(extractErrorMessage(loadVotersError));
      } finally {
        setLoadingVoterOptions(false);
      }
    },
    [activeElectionId]
  );

  const handleAddAttendance = useCallback(async () => {
    if (!selectedVoter) {
      setAddAttendanceError("Please select a voter name.");
      return;
    }

    if (!activeElectionId) {
      setNotice({
        tone: "warning",
        message: "No election selected for attendance.",
      });
      return;
    }

    try {
      setAddingAttendance(true);
      setAddAttendanceError(null);
      const response = await upsertAttendance({
        election_id: activeElectionId,
        voter_id: selectedVoter.voterId,
        status: "present",
      });

      setNotice({
        tone: "success",
        message: response.message,
      });
      setAddAttendanceOpen(false);
      setSelectedVoter(null);
      setVoterDropdownOpen(false);
      await loadAttendances(activeElectionId, recordsPage);
    } catch (addError) {
      const message = extractErrorMessage(addError);
      const lowerMessage = message.toLowerCase();
      setNotice({
        tone: lowerMessage.includes("already") && lowerMessage.includes("present") ? "warning" : "error",
        message,
      });
      setAddAttendanceError(message);
    } finally {
      setAddingAttendance(false);
    }
  }, [activeElectionId, loadAttendances, recordsPage, selectedVoter]);

  const handleDeleteAttendance = useCallback(async () => {
    if (deleteConfirmationInput.trim().toUpperCase() !== "DELETE ALL") {
      setDeleteAttendanceError('Type "DELETE ALL" to confirm.');
      return;
    }

    if (!activeElectionId) {
      setNotice({
        tone: "warning",
        message: "No election selected for attendance deletion.",
      });
      return;
    }

    const confirmed = window.confirm(
      "Delete all attendance records for the selected election and remove voter accounts except protected accounts?"
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeletingAttendance(true);
      setDeleteAttendanceError(null);
      const response = await startDelete(activeElectionId, "DELETE ALL");
      const deletedUsers = response.meta.deleted_users ?? 0;
      setNotice({
        tone: "success",
        message: `${response.message} Attendance deleted: ${response.meta.deleted}. Users deleted: ${deletedUsers}.`,
      });
      setDeleteAttendanceOpen(false);
      setDeleteConfirmationInput("");
      await loadAttendances(activeElectionId, recordsPage);
    } catch (deleteError) {
      setNotice({
        tone: "error",
        message: extractErrorMessage(deleteError),
      });
      setDeleteAttendanceError(extractErrorMessage(deleteError));
    } finally {
      setDeletingAttendance(false);
    }
  }, [activeElectionId, deleteConfirmationInput, loadAttendances, recordsPage, startDelete]);

  const openDeleteAttendanceDialog = useCallback(() => {
    if (!activeElectionId) {
      setNotice({
        tone: "warning",
        message: "No election selected for attendance deletion.",
      });
      return;
    }

    setDeleteAttendanceOpen(true);
    setDeleteConfirmationInput("");
    setDeleteAttendanceError(null);
  }, [activeElectionId]);

  const openScannerDialog = useCallback(() => {
    setScanOpen(true);
    setScanError(null);
    setScanHint("Allow camera access and point to voter QR code.");
    setScanValidation(null);
  }, []);

  const processScannedQrValue = useCallback(
    async (rawValue: string) => {
      if (scanBusyRef.current) {
        return;
      }

      const voterId = parseVoterIdFromQr(rawValue);
      if (!voterId) {
        const message = "QR detected but voter ID was not found in the code.";
        setScanError(message);
        setScanValidation({
          tone: "error",
          message,
          voterId: null,
          at: Date.now(),
        });
        return;
      }

      const now = Date.now();
      if (lastScannedRef.current && lastScannedRef.current.voterId === voterId && now - lastScannedRef.current.at < 2000) {
        return;
      }

      lastScannedRef.current = { voterId, at: now };
      scanBusyRef.current = true;
      setScanError(null);
      setScanHint("Validating voter attendance...");

      try {
        await handleScannedVoter(voterId);
      } finally {
        scanBusyRef.current = false;
        setScanHint(scanOpen ? "Scanning QR code..." : "Allow camera access and point to voter QR code.");
      }
    },
    [handleScannedVoter, scanOpen]
  );

  const handleUploadQrFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setScanError("Please upload an image file containing a QR code.");
        return;
      }

      const imageUrl = URL.createObjectURL(file);
      setUploadingQr(true);
      setScanError(null);
      setScanHint("Reading uploaded QR image...");

      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const result = await reader.decodeFromImageUrl(imageUrl);
        const rawValue = result?.getText()?.trim();

        if (!rawValue) {
          setScanError("No QR data found in uploaded image.");
          return;
        }

        await processScannedQrValue(rawValue);
      } catch {
        setScanError("Unable to read QR from uploaded image. Try a clearer QR photo.");
      } finally {
        URL.revokeObjectURL(imageUrl);
        setUploadingQr(false);
      }
    },
    [processScannedQrValue]
  );

  useEffect(() => {
    void (async () => {
      try {
        const loadedElections = await getElections();

        if (loadedElections.length > 0) {
          const defaultElection =
            loadedElections.find((election) => election.status === "open") ?? loadedElections[0];
          setActiveElectionId(defaultElection.id);
          setActiveElectionLabel(`${defaultElection.title} (#${defaultElection.id})`);
          setActiveElectionStatus(defaultElection.status);
          await loadAttendances(defaultElection.id, 1);
        } else {
          setActiveElectionId(null);
          setActiveElectionLabel("No election selected");
          setActiveElectionStatus(null);
          setRecordsMeta(null);
          setRecordsPage(1);
        }
      } catch (loadError) {
        setNotice({
          tone: "error",
          message: extractErrorMessage(loadError),
        });
      }
    })();
  }, [loadAttendances]);

  useEffect(() => {
    let cancelled = false;
    scanBusyRef.current = false;

    if (!scanOpen) {
      stopScanner();
      return;
    }

    const startScanner = async () => {
      setScanError(null);
      setScanHint("Allow camera access and point to voter QR code.");

      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError("Camera is not available in this browser.");
        return;
      }

      if (!videoRef.current) {
        window.setTimeout(() => {
          if (!cancelled) {
            void startScanner();
          }
        }, 16);
        return;
      }

      try {
        const { BrowserCodeReader, BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) {
          return;
        }

        const devices = await BrowserCodeReader.listVideoInputDevices();
        const preferredDevice =
          devices.find((device) => /(back|rear|environment)/i.test(device.label)) ?? devices[0] ?? null;

        const videoConstraints = preferredDevice
          ? {
              deviceId: { exact: preferredDevice.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 },
            };

        const codeReader = new BrowserQRCodeReader();
        setScanHint("Scanning QR code...");

        const controls = await codeReader.decodeFromConstraints({ audio: false, video: videoConstraints }, videoRef.current, (result) => {
          if (cancelled || scanBusyRef.current) {
            return;
          }

          const raw = result?.getText()?.trim();
          if (!raw) {
            return;
          }

          void processScannedQrValue(raw);
        });

        if (cancelled) {
          controls.stop();
          return;
        }

        zxingControlsRef.current = controls;
      } catch (scanInitError) {
        const message = scanInitError instanceof Error ? scanInitError.message.toLowerCase() : "";
        if (message.includes("permission") || message.includes("notallowed")) {
          setScanError("Camera permission was denied. Allow camera access, then try again.");
        } else {
          setScanError("Unable to initialize QR scanner. Check camera permission and use HTTPS or localhost.");
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [processScannedQrValue, scanOpen, stopScanner]);

  useEffect(() => {
    if (!addAttendanceOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadVoterOptions(voterSearch.trim());
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [addAttendanceOpen, loadVoterOptions, voterSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };

    if (actionsMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [actionsMenuOpen]);

  useEffect(() => {
    if (!voterDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (voterDropdownRef.current && !voterDropdownRef.current.contains(event.target as Node)) {
        setVoterDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [voterDropdownOpen]);

  useEffect(() => {
    if (!voterDropdownOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      voterSearchInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [voterDropdownOpen]);

  const voterSelectOptions = voterOptions
    .filter((voter) => Boolean(voter.voter_id))
    .map((voter) => ({
      value: String(voter.voter_id),
      label: `${voter.name} (${formatUserRole(voter.role)})${voter.branch ? ` - ${voter.branch}` : ""}`,
    }));
  const visibleRecords = view === "attendance" ? records.filter((row) => row.status === "present") : records;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck2 className="h-5 w-5" />
            Attendance Dashboard
          </CardTitle>
          <CardDescription>Overview of attendance activity and participation trends.</CardDescription>
        </CardHeader>
      </Card>

      {notice ? (
        <ActionAlert
          tone={notice.tone}
          message={notice.message}
          autoHideMs={3000}
          onAutoHide={() => setNotice(null)}
          onClose={() => setNotice(null)}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-xl font-bold text-foreground">{summary.total}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Present</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-muted-foreground">
            <UserCheck2 className="h-4 w-4" />
            <span className="text-xl font-bold text-foreground">{summary.present}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Absent</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-muted-foreground">
            <UserX className="h-4 w-4" />
            <span className="text-xl font-bold text-foreground">{summary.absent}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>Recent Attendance</CardTitle>
            <CardDescription>Attendance records for the selected election: {activeElectionLabel}.</CardDescription>
            {activeElectionId && activeElectionStatus === "open" ? (
              <div className="mt-2">
                <a
                  href={buildAttendanceLink(activeElectionId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-primary hover:bg-secondary/80"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  Open Attendance Link
                </a>
              </div>
            ) : null}
          </div>
          <input
            ref={attendanceImportInputRef}
            type="file"
            accept=".csv,text/csv,.txt,text/plain"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleImportAttendance(event);
            }}
          />
          {view === "records" ? (
            <div className="relative" ref={actionsMenuRef}>
              <Button
                type="button"
                variant="outline"
                className="px-4"
                onClick={() => {
                  setActionsMenuOpen((current) => !current);
                }}
              >
                ...
              </Button>

              {actionsMenuOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-60 rounded-md border bg-card p-1 shadow-lg">
                  <button
                    type="button"
                    className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!activeElectionId}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      setAddAttendanceOpen(true);
                      setSelectedVoter(null);
                      setVoterDropdownOpen(false);
                      setVoterSearch("");
                      setVoterOptions([]);
                      setAddAttendanceError(null);
                      setAddAttendanceLookupError(null);
                    }}
                  >
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    Add Attendance
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!activeElectionId || importingAttendance}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      attendanceImportInputRef.current?.click();
                    }}
                  >
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    {importingAttendance ? `Importing... ${attendanceTaskProgress}%` : "Import Attendance"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!activeElectionId || exporting}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      void handleExportPresent();
                    }}
                  >
                    <Download className="h-4 w-4 text-muted-foreground" />
                    {exporting ? "Exporting..." : "Export Present Attendance"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!activeElectionId}
                    onClick={() => {
                      setActionsMenuOpen(false);
                      openDeleteAttendanceDialog();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Attendance
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="inline-flex items-center gap-2"
                disabled={!activeElectionId}
                onClick={() => {
                  openScannerDialog();
                }}
              >
                <Camera className="h-4 w-4" />
                Open Attendance Scanner
              </Button>
              <Button
                type="button"
                variant="outline"
                className="inline-flex items-center gap-2"
                disabled={!activeElectionId}
                onClick={openDeleteAttendanceDialog}
              >
                <Trash2 className="h-4 w-4" />
                Delete Attendance
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Attendance Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && visibleRecords.length === 0
                ? Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={`attendance-skeleton-${index}`}>
                      <TableCell>
                        <div className="h-3 w-40 animate-pulse rounded bg-secondary" />
                      </TableCell>
                      <TableCell>
                        <div className="h-3 w-28 animate-pulse rounded bg-secondary" />
                      </TableCell>
                      <TableCell>
                        <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
                      </TableCell>
                      <TableCell>
                        <div className="h-6 w-20 animate-pulse rounded-full bg-secondary" />
                      </TableCell>
                    </TableRow>
                  ))
                : visibleRecords.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.user?.name ?? "-"}</TableCell>
                  <TableCell>{row.user?.branch ?? "-"}</TableCell>
                  <TableCell>{row.checked_in_at ? new Date(row.checked_in_at).toLocaleString() : "-"}</TableCell>
                  <TableCell>
                    {row.status === "present" ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Present</Badge>
                    ) : (
                      <Badge variant="secondary">Absent</Badge>
                    )}
                  </TableCell>
                </TableRow>
                  ))}
              {!loading && visibleRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No attendance records found.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Page {recordsMeta?.current_page ?? recordsPage} of {recordsMeta?.last_page ?? 1}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeElectionId || loading || recordsPage <= 1}
                onClick={() => {
                  if (!activeElectionId || recordsPage <= 1) {
                    return;
                  }
                  void loadAttendances(activeElectionId, recordsPage - 1);
                }}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeElectionId || loading || Boolean(recordsMeta && recordsPage >= recordsMeta.last_page)}
                onClick={() => {
                  if (!activeElectionId || (recordsMeta && recordsPage >= recordsMeta.last_page)) {
                    return;
                  }
                  void loadAttendances(activeElectionId, recordsPage + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={addAttendanceOpen}
        onOpenChange={(open) => {
          setAddAttendanceOpen(open);
          if (!open) {
            setSelectedVoter(null);
            setVoterDropdownOpen(false);
            setVoterSearch("");
            setVoterOptions([]);
            setAddAttendanceError(null);
            setAddAttendanceLookupError(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Attendance
            </AlertDialogTitle>
            <AlertDialogDescription>Select voter name to mark attendance as present.</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <div className="relative" ref={voterDropdownRef}>
              <button
                type="button"
                className="flex h-10 w-full items-center justify-between rounded-[9px] border border-input bg-card px-3 py-2 text-sm"
                disabled={addingAttendance}
                onClick={() => {
                  setVoterDropdownOpen((current) => !current);
                }}
              >
                <span className={selectedVoter ? "text-foreground" : "text-muted-foreground"}>
                  {selectedVoter ? selectedVoter.label : "Select voter name"}
                </span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", voterDropdownOpen ? "rotate-180" : "")} />
              </button>

              {voterDropdownOpen ? (
                <div className="absolute z-20 mt-1 w-full rounded-[9px] border bg-card shadow-md">
                  <div className="border-b p-2">
                    <Input
                      ref={voterSearchInputRef}
                      value={voterSearch}
                      onChange={(event) => {
                        setVoterSearch(event.target.value);
                        setSelectedVoter(null);
                        if (addAttendanceError) {
                          setAddAttendanceError(null);
                        }
                      }}
                      placeholder="Search voter name"
                    />
                  </div>

                  <div className="max-h-[18rem] overflow-y-auto p-1">
                    {loadingVoterOptions ? (
                      <p className="px-2 py-2 text-sm text-muted-foreground">Loading voters...</p>
                    ) : addAttendanceLookupError ? (
                      <p className="px-2 py-2 text-sm text-destructive">{addAttendanceLookupError}</p>
                    ) : voterSelectOptions.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-muted-foreground">No voters found for the current search.</p>
                    ) : (
                      voterSelectOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={cn(
                            "flex h-9 w-full items-center rounded-md px-2 text-left text-sm hover:bg-secondary",
                            selectedVoter?.voterId === option.value ? "bg-secondary text-foreground" : "text-foreground"
                          )}
                          onClick={() => {
                            setSelectedVoter({ voterId: option.value, label: option.label });
                            setVoterDropdownOpen(false);
                            if (addAttendanceError) {
                              setAddAttendanceError(null);
                            }
                          }}
                        >
                          {option.label}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {addAttendanceError ? <p className="text-sm text-destructive">{addAttendanceError}</p> : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={addingAttendance}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              disabled={addingAttendance}
              onClick={() => {
                void handleAddAttendance();
              }}
            >
              {addingAttendance ? "Adding..." : "Add Attendance"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteAttendanceOpen}
        onOpenChange={(open) => {
          setDeleteAttendanceOpen(open);
          if (!open) {
            setDeleteConfirmationInput("");
            setDeleteAttendanceError(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="inline-flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Delete Attendance
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will delete attendance records for the selected election and remove voter users except protected accounts. Type <span className="font-semibold">DELETE ALL</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Input
              value={deleteConfirmationInput}
              onChange={(event) => {
                setDeleteConfirmationInput(event.target.value);
                if (deleteAttendanceError) {
                  setDeleteAttendanceError(null);
                }
              }}
              placeholder='Type "DELETE ALL"'
              disabled={deletingAttendance}
            />
            {deleteAttendanceError ? <p className="text-sm text-destructive">{deleteAttendanceError}</p> : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAttendance}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingAttendance}
              onClick={() => {
                void handleDeleteAttendance();
              }}
            >
              {deletingAttendance ? "Deleting..." : "Delete Attendance"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={scanOpen}
        onOpenChange={(open) => {
          setScanOpen(open);
          if (!open) {
            stopScanner();
          }
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="inline-flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Attendance Scanner
            </AlertDialogTitle>
            <AlertDialogDescription>{scanHint}</AlertDialogDescription>
          </AlertDialogHeader>

          <input
            ref={qrUploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUploadQrFile(file);
              }

              event.target.value = "";
            }}
          />

          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-black/90">
              <video ref={videoRef} className="h-56 w-full object-cover" autoPlay muted playsInline />
            </div>
            {scanError ? <p className="text-sm text-destructive">{scanError}</p> : null}
            {scanValidation ? (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-sm",
                  scanValidation.tone === "success" && "border-emerald-300 bg-emerald-50 text-emerald-800",
                  scanValidation.tone === "warning" && "border-amber-300 bg-amber-50 text-amber-800",
                  scanValidation.tone === "error" && "border-rose-300 bg-rose-50 text-rose-800"
                )}
              >
                <p className="font-semibold">{scanValidation.message}</p>
                <p className="mt-1 text-xs">
                  {scanValidation.voterId ? `Voter ID: ${scanValidation.voterId} - ` : ""}
                  {new Date(scanValidation.at).toLocaleTimeString()}
                </p>
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={uploadingQr}
              onClick={() => {
                qrUploadInputRef.current?.click();
              }}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {uploadingQr ? "Uploading..." : "Upload QR"}
            </Button>
            <AlertDialogCancel
              onClick={() => {
                setScanOpen(false);
              }}
            >
              Close
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
