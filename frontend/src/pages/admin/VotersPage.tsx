import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Download, FileDown, FileText, FileUp, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import JSZip from "jszip";
import QRCode from "qrcode";
import { getElections } from "@/api/elections";
import {
  createVoter,
  deleteAllVotersExceptProtected,
  deleteVoter,
  downloadVoterTemplate,
  exportVoterLogs,
  exportVoters,
  getVoters,
  updateVoter,
} from "@/api/users";
import { extractErrorMessage } from "@/api/client";
import type { Election, PaginationMeta, User } from "@/api/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActionAlert } from "@/components/ui/action-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useVoterImport } from "@/hooks/useVoterImport";
import { buildVoterQrCardBlob, buildVoterQrCardPng, getStoredVoterCardTemplateLayout } from "@/lib/voterCardTemplate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface NewVoterFormState {
  name: string;
  branch: string;
  email: string;
  voter_id: string;
  voter_key: string;
  is_active: boolean;
}

const DEFAULT_NEW_VOTER: NewVoterFormState = {
  name: "",
  branch: "",
  email: "",
  voter_id: "",
  voter_key: "",
  is_active: true,
};

const BRANCH_FILTER_OPTIONS = [
  "Barbaza",
  "Culasi",
  "Sibalom",
  "San Jose",
  "Balasan",
  "Barotac Viejo",
  "Caticlan",
  "Molo",
  "Kalibo",
  "Janiuay",
  "Calinog",
  "Sara",
  "President Roxas",
] as const;

const QR_EXPORT_BATCH_SIZE = 8;

function buildVoterQrPayload(voterId: string, voterKey: string): string {
  return `voter_id=${encodeURIComponent(voterId)}&voter_key=${encodeURIComponent(voterKey)}`;
}

function sanitizeFileName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "voter";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function buildVoterQrCardDataUrl(options: {
  voterId: string;
  voterKey: string;
  voterName: string;
  branch: string;
  layout?: Parameters<typeof buildVoterQrCardPng>[0]["layout"];
}) {
  const payload = buildVoterQrPayload(options.voterId, options.voterKey);
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "H",
    margin: 4,
    width: 280,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  return buildVoterQrCardPng({
    qrDataUrl,
    voterName: options.voterName,
    branch: options.branch,
    layout: options.layout,
  });
}

export function VotersPage() {
  const [elections, setElections] = useState<Election[]>([]);
  const [voters, setVoters] = useState<User[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [electionId, setElectionId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [exportingQRCodes, setExportingQRCodes] = useState(false);
  const [exportQrProgress, setExportQrProgress] = useState<{ processed: number; total: number } | null>(null);
  const [addingVoter, setAddingVoter] = useState(false);
  const [deletingVoterId, setDeletingVoterId] = useState<number | null>(null);
  const [deletingAllVoters, setDeletingAllVoters] = useState(false);
  const [voterToDelete, setVoterToDelete] = useState<User | null>(null);
  const [deleteAllVotersOpen, setDeleteAllVotersOpen] = useState(false);
  const [qrVoter, setQrVoter] = useState<User | null>(null);
  const [qrCardDataUrl, setQrCardDataUrl] = useState<string | null>(null);
  const [loadingQrCard, setLoadingQrCard] = useState(false);
  const [editingVoterId, setEditingVoterId] = useState<number | null>(null);
  const [showAddVoterForm, setShowAddVoterForm] = useState(false);
  const [newVoter, setNewVoter] = useState<NewVoterFormState>(DEFAULT_NEW_VOTER);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadVotersRequestIdRef = useRef(0);
  const {
    startImport,
    isImporting: importing,
    progress: importProgress,
    status: importStatus,
    processed: importProcessed,
    total: importTotal,
  } = useVoterImport();

  const loadElections = useCallback(async () => {
    try {
      const data = await getElections();
      const available = data.filter((item) => item.status === "open" || item.status === "closed");
      setElections(available);

      if (available.length === 0) {
        setElectionId(undefined);
        return;
      }

      setElectionId((current) =>
        current && available.some((item) => item.id === current) ? current : available[0].id
      );
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    }
  }, []);

  const loadVoters = useCallback(async () => {
    const requestId = loadVotersRequestIdRef.current + 1;
    loadVotersRequestIdRef.current = requestId;

    try {
      setLoading(true);
      const response = await getVoters(page, 25, search, electionId, branchFilter || undefined);
      if (requestId !== loadVotersRequestIdRef.current) {
        return;
      }
      setVoters(response.data);
      setMeta(response.meta);
      setError(null);
    } catch (loadError) {
      if (requestId !== loadVotersRequestIdRef.current) {
        return;
      }
      setError(extractErrorMessage(loadError));
    } finally {
      if (requestId === loadVotersRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, search, electionId, branchFilter]);

  useEffect(() => {
    void loadElections();
  }, [loadElections]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    void loadVoters();
  }, [loadVoters]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  const branchOptions = useMemo(() => BRANCH_FILTER_OPTIONS.map((branch) => ({ value: branch, label: branch })), []);
  const electionOptions = useMemo(
    () =>
      elections.map((item) => ({
        value: String(item.id),
        label: `${item.title} (${item.status})`,
      })),
    [elections]
  );

  const selectedElection = useMemo(
    () => elections.find((item) => item.id === electionId) ?? null,
    [elections, electionId]
  );

  const voterFormBranchOptions = useMemo(() => {
    const options: string[] = [...BRANCH_FILTER_OPTIONS];
    const selectedBranch = newVoter.branch.trim();

    if (selectedBranch !== "" && !options.some((branch) => branch.toLowerCase() === selectedBranch.toLowerCase())) {
      options.push(selectedBranch);
    }

    return options.map((branch) => ({ value: branch, label: branch }));
  }, [newVoter.branch]);

  const handleExportVoters = async () => {
    try {
      setError(null);
      setSuccess(null);
      await exportVoters(search, electionId, branchFilter || undefined);
      setSuccess("Voters exported successfully.");
      setMenuOpen(false);
    } catch (exportError) {
      setError(extractErrorMessage(exportError));
    }
  };

  const handleExportVoterLogs = async () => {
    if (!electionId) {
      setError("Select an election first to export voter logs.");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      await exportVoterLogs(search, electionId, branchFilter || undefined);
      setSuccess("Voter logs exported successfully.");
      setMenuOpen(false);
    } catch (exportError) {
      setError(extractErrorMessage(exportError));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      setError(null);
      setSuccess(null);
      await downloadVoterTemplate();
      setSuccess("Voter import template downloaded.");
      setMenuOpen(false);
    } catch (downloadError) {
      setError(extractErrorMessage(downloadError));
    }
  };

  const handleImportVoters = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      let importedFileCount = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalProcessed = 0;
      let totalSkipped = 0;
      let firstFailedFileError: string | null = null;

      for (const file of files) {
        try {
          const response = await startImport(file);
          importedFileCount += 1;
          totalCreated += response.meta.created;
          totalUpdated += response.meta.updated;
          totalProcessed += response.meta.total_processed;
          totalSkipped += response.meta.skipped ?? 0;
        } catch (importError) {
          if (!firstFailedFileError) {
            firstFailedFileError = `${file.name}: ${extractErrorMessage(importError)}`;
          }
        }
      }

      if (importedFileCount > 0) {
        await loadVoters();
      }

      if (importedFileCount === 0) {
        setError(firstFailedFileError ?? "No files were imported.");
        return;
      }

      const summaryPrefix =
        files.length > 1
          ? `Imported ${importedFileCount}/${files.length} file(s).`
          : "Import complete.";
      setSuccess(
        `${summaryPrefix} ${totalCreated} created, ${totalUpdated} updated, ${totalProcessed} processed, ${totalSkipped} skipped.`
      );

      if (firstFailedFileError) {
        setError(`Some files failed. First failed file: ${firstFailedFileError}`);
      }

      setMenuOpen(false);
    } catch (importError) {
      if (importError instanceof Error && importError.message.trim() !== "") {
        setError(importError.message);
      } else {
        setError(extractErrorMessage(importError));
      }
    }
  };

  const fetchAllVotersForQr = async () => {
    const allVoters: User[] = [];
    let currentPage = 1;
    const perPage = 200;

    while (true) {
      const response = await getVoters(currentPage, perPage, search, electionId, branchFilter || undefined);
      allVoters.push(...response.data);

      if (currentPage >= response.meta.last_page) {
        break;
      }

      currentPage += 1;
    }

    return allVoters;
  };

  const buildVoterCardFileName = (voter: User) => {
    const voterId = voter.voter_id ?? "voter";
    const branch = voter.branch?.trim() ? voter.branch.trim() : "N/A";
    const safeName = sanitizeFileName(voter.name);
    const safeBranch = sanitizeFileName(branch);
    const safeVoterId = sanitizeFileName(voterId);
    return `${safeName}_${safeBranch}_${safeVoterId}.png`;
  };

  const handleExportVoterQRCodes = async () => {
    try {
      setExportingQRCodes(true);
      setExportQrProgress(null);
      setError(null);
      setSuccess(null);
      const templateLayout = getStoredVoterCardTemplateLayout();

      const allVoters = await fetchAllVotersForQr();
      const exportableVoters = allVoters.filter((voter) => voter.voter_id && voter.voter_key);

      if (exportableVoters.length === 0) {
        setError("No voters with both voter ID and voter key were found for QR export.");
        return;
      }

      const zip = new JSZip();
      const total = exportableVoters.length;
      setExportQrProgress({ processed: 0, total });

      for (let batchStart = 0; batchStart < total; batchStart += QR_EXPORT_BATCH_SIZE) {
        const batch = exportableVoters.slice(batchStart, batchStart + QR_EXPORT_BATCH_SIZE);
        const generatedCards = await Promise.all(
          batch.map(async (voter, batchIndex) => {
            const voterId = voter.voter_id as string;
            const voterKey = voter.voter_key as string;
            const branch = voter.branch?.trim() ? voter.branch.trim() : "N/A";
            const qrPayload = buildVoterQrPayload(voterId, voterKey);
            const qrDataUrl = await QRCode.toDataURL(qrPayload, {
              errorCorrectionLevel: "H",
              margin: 4,
              width: 280,
              color: {
                dark: "#000000",
                light: "#ffffff",
              },
            });
            const cardBlob = await buildVoterQrCardBlob({
              qrDataUrl,
              voterName: voter.name,
              branch,
              layout: templateLayout,
            });
            const absoluteIndex = batchStart + batchIndex;
            const fileName = `${String(absoluteIndex + 1).padStart(3, "0")}_${buildVoterCardFileName(voter)}`;
            return { fileName, cardBlob };
          })
        );

        for (const item of generatedCards) {
          zip.file(item.fileName, item.cardBlob);
        }

        const processed = Math.min(batchStart + batch.length, total);
        setExportQrProgress({ processed, total });

        if (processed < total) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
        }
      }

      const readmeLines = [
        "Coop Vote - Voter QR Card Export",
        "",
        "Each PNG is an ID-style card: QR on the left, voter details on the right.",
        "QR payload format: voter_id=<value>&voter_key=<value>",
        electionId ? `Election access route: /access/${electionId}` : "Election access route: /access/{electionId}",
        "",
        "Scan from the Voter Access page.",
      ];

      zip.file("README.txt", readmeLines.join("\n"));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      downloadBlob(zipBlob, `voter_qr_cards_${timestamp}.zip`);

      setSuccess(`Exported ${exportableVoters.length} voter QR cards.`);
      setMenuOpen(false);
    } catch (exportError) {
      if (exportError instanceof Error && exportError.message.trim() !== "") {
        setError(exportError.message);
      } else {
        setError(extractErrorMessage(exportError));
      }
    } finally {
      setExportingQRCodes(false);
      setExportQrProgress(null);
    }
  };

  const handleOpenVoterQr = async (voter: User) => {
    if (!voter.voter_id || !voter.voter_key) {
      setError(`Cannot generate QR for "${voter.name}" because voter ID or voter key is missing.`);
      return;
    }

    setQrVoter(voter);
    setQrCardDataUrl(null);
    setLoadingQrCard(true);
    setError(null);

    try {
      const branch = voter.branch?.trim() ? voter.branch.trim() : "N/A";
      const templateLayout = getStoredVoterCardTemplateLayout();
      const cardDataUrl = await buildVoterQrCardDataUrl({
        voterId: voter.voter_id,
        voterKey: voter.voter_key,
        voterName: voter.name,
        branch,
        layout: templateLayout,
      });

      setQrCardDataUrl(cardDataUrl);
    } catch (qrError) {
      setQrVoter(null);
      setQrCardDataUrl(null);
      setError(extractErrorMessage(qrError));
    } finally {
      setLoadingQrCard(false);
    }
  };

  const handleDownloadSingleQrCard = async () => {
    if (!qrVoter || !qrCardDataUrl) {
      return;
    }

    try {
      const response = await fetch(qrCardDataUrl);
      const blob = await response.blob();
      downloadBlob(blob, buildVoterCardFileName(qrVoter));
    } catch (downloadError) {
      setError(extractErrorMessage(downloadError));
    }
  };

  const handleEditVoter = (voter: User) => {
    setEditingVoterId(voter.id);
    setNewVoter({
      name: voter.name,
      branch: voter.branch ?? "",
      email: voter.email ?? "",
      voter_id: voter.voter_id ?? "",
      voter_key: voter.voter_key ?? "",
      is_active: voter.is_active,
    });
    setShowAddVoterForm(true);
    setError(null);
    setSuccess(null);
  };

  const handleSaveVoter = async () => {
    if (!newVoter.name.trim() || !newVoter.voter_id.trim() || !newVoter.voter_key.trim()) {
      setError("Name, voter ID, and voter key are required.");
      return;
    }

    try {
      setAddingVoter(true);
      setError(null);
      setSuccess(null);

      const payload = {
        name: newVoter.name.trim(),
        branch: newVoter.branch.trim() || null,
        email: newVoter.email.trim() || null,
        voter_id: newVoter.voter_id.trim(),
        voter_key: newVoter.voter_key.trim(),
        is_active: newVoter.is_active,
      };

      if (editingVoterId) {
        await updateVoter(editingVoterId, payload);
      } else {
        await createVoter(payload);
      }

      setNewVoter(DEFAULT_NEW_VOTER);
      setEditingVoterId(null);
      setShowAddVoterForm(false);
      await loadVoters();
      setSuccess(editingVoterId ? "Voter updated successfully." : "Voter added successfully.");
    } catch (createError) {
      setError(extractErrorMessage(createError));
    } finally {
      setAddingVoter(false);
    }
  };

  const handleDeleteVoter = (voter: User) => {
    setVoterToDelete(voter);
  };

  const confirmDeleteVoter = async () => {
    if (!voterToDelete) {
      return;
    }

    const targetVoter = voterToDelete;

    try {
      setDeletingVoterId(targetVoter.id);
      setError(null);
      setSuccess(null);
      await deleteVoter(targetVoter.id);
      await loadVoters();
      setSuccess(`Voter "${targetVoter.name}" deleted.`);
      setVoterToDelete(null);
    } catch (deleteError) {
      setError(extractErrorMessage(deleteError));
      setVoterToDelete(null);
    } finally {
      setDeletingVoterId(null);
    }
  };

  const handleDeleteAllVoters = async () => {
    try {
      setDeletingAllVoters(true);
      setError(null);
      setSuccess(null);

      const response = await deleteAllVotersExceptProtected("DELETE VOTERS");
      await loadVoters();
      setSuccess(response.message);
      setDeleteAllVotersOpen(false);
      setMenuOpen(false);
    } catch (deleteError) {
      setError(extractErrorMessage(deleteError));
    } finally {
      setDeletingAllVoters(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voters</CardTitle>
        <CardDescription>Track voter participation and export voter records.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto_auto] md:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleImportVoters(event);
            }}
          />

          <Input
            placeholder="Search by name, branch, email, or voter ID"
            value={searchInput}
            onChange={(event) => {
              setPage(1);
              setSearchInput(event.target.value);
            }}
          />

          <Select
            options={electionOptions}
            value={electionId ? String(electionId) : ""}
            placeholder={elections.length > 0 ? "Select election" : "No open/closed elections"}
            disabled={elections.length === 0}
            onChange={(event) => {
              setPage(1);
              const nextElectionId = Number(event.target.value);
              setElectionId(Number.isFinite(nextElectionId) && nextElectionId > 0 ? nextElectionId : undefined);
            }}
          />

          <Select
            options={branchOptions}
            value={branchFilter}
            placeholder="All branches"
            onChange={(event) => {
              setPage(1);
              setBranchFilter(event.target.value);
            }}
          />

          <Button
            className="inline-flex items-center gap-2 bg-blue-600 text-white hover:bg-blue-700 hover:text-white"
            onClick={() => {
              setShowAddVoterForm((current) => !current);
              setEditingVoterId(null);
              setNewVoter(DEFAULT_NEW_VOTER);
              setError(null);
              setSuccess(null);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Voter
          </Button>

          <div className="relative" ref={menuRef}>
            <Button
              variant="outline"
              className="px-4"
              onClick={() => {
                setMenuOpen((current) => !current);
              }}
            >
              ...
            </Button>

            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-md border bg-card p-1 shadow-lg">
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void handleDownloadTemplate();
                  }}
                >
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Download Template
                </button>
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={importing}
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                >
                  <FileUp className="h-4 w-4 text-muted-foreground" />
                  {importing
                    ? importStatus === "processing"
                      ? importTotal > 0
                        ? `Importing... ${importProgress}% (${importProcessed}/${importTotal})`
                        : `Importing... ${importProgress}%`
                      : `Importing... ${importProgress}%`
                    : "Import Voters"}
                </button>
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void handleExportVoters();
                  }}
                >
                  <FileDown className="h-4 w-4 text-muted-foreground" />
                  Export Voters
                </button>
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    void handleExportVoterLogs();
                  }}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Export Voter Logs
                </button>
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={exportingQRCodes}
                  onClick={() => {
                    void handleExportVoterQRCodes();
                  }}
                >
                  <QrCode className="h-4 w-4 text-muted-foreground" />
                  {exportingQRCodes
                    ? exportQrProgress
                      ? `Generating QR Cards (${exportQrProgress.processed}/${exportQrProgress.total})...`
                      : "Generating QR Cards..."
                    : "Export Voter QR Cards"}
                </button>
                <button
                  className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={deletingAllVoters}
                  onClick={() => {
                    setDeleteAllVotersOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Voters
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Vote status is shown for:{" "}
          <span className="font-medium text-foreground">
            {selectedElection ? `${selectedElection.title} (#${selectedElection.id})` : "No election selected"}
          </span>
        </p>
        {exportingQRCodes && exportQrProgress ? (
          <p className="text-xs text-muted-foreground">
            Generating QR cards: {exportQrProgress.processed}/{exportQrProgress.total}
          </p>
        ) : null}
        {importing ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {importStatus === "processing"
                ? importTotal > 0
                  ? `Processing imported voters... ${importProgress}% (${importProcessed}/${importTotal})`
                  : `Processing imported voters... ${importProgress}%`
                : `Uploading voter import file... ${importProgress}%`}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${importProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {showAddVoterForm ? (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {editingVoterId ? "Edit Voter" : "Add Voter"}
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="voter-name">Name *</Label>
                <Input
                  id="voter-name"
                  value={newVoter.name}
                  onChange={(event) => setNewVoter((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="voter-branch">Branch</Label>
                <Select
                  id="voter-branch"
                  options={voterFormBranchOptions}
                  value={newVoter.branch}
                  placeholder="Select branch (optional)"
                  onChange={(event) => setNewVoter((current) => ({ ...current, branch: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="voter-email">Email (optional)</Label>
                <Input
                  id="voter-email"
                  type="email"
                  value={newVoter.email}
                  onChange={(event) => setNewVoter((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="voter-id">Voter ID *</Label>
                <Input
                  id="voter-id"
                  value={newVoter.voter_id}
                  onChange={(event) => setNewVoter((current) => ({ ...current, voter_id: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="voter-key">Voter Key *</Label>
                <Input
                  id="voter-key"
                  value={newVoter.voter_key}
                  onChange={(event) => setNewVoter((current) => ({ ...current, voter_key: event.target.value }))}
                />
              </div>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={newVoter.is_active}
                onChange={(event) => setNewVoter((current) => ({ ...current, is_active: event.target.checked }))}
              />
              Active voter
            </label>

            <div className="mt-4 flex items-center gap-2">
              <Button
                type="button"
                disabled={addingVoter}
                onClick={() => {
                  void handleSaveVoter();
                }}
              >
                {addingVoter ? (editingVoterId ? "Saving..." : "Adding...") : editingVoterId ? "Save Changes" : "Save Voter"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={addingVoter}
                onClick={() => {
                  setShowAddVoterForm(false);
                  setEditingVoterId(null);
                  setNewVoter(DEFAULT_NEW_VOTER);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <ActionAlert
            tone="error"
            message={error}
            autoHideMs={5000}
            onAutoHide={() => setError(null)}
            onClose={() => setError(null)}
          />
        ) : null}
        {success ? <ActionAlert tone="success" message={success} autoHideMs={1000} onAutoHide={() => setSuccess(null)} /> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NAME</TableHead>
              <TableHead>BRANCH</TableHead>
              <TableHead>VOTER ID</TableHead>
              <TableHead>VOTER KEY</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead>ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && voters.length === 0
              ? Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={`voter-skeleton-${index}`}>
                    <TableCell>
                      <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
                    </TableCell>
                    <TableCell>
                      <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
                    </TableCell>
                    <TableCell>
                      <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
                    </TableCell>
                    <TableCell>
                      <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
                    </TableCell>
                    <TableCell>
                      <div className="h-6 w-20 animate-pulse rounded-full bg-secondary" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 animate-pulse rounded-[9px] bg-secondary" />
                        <div className="h-9 w-9 animate-pulse rounded-[9px] bg-secondary" />
                        <div className="h-9 w-9 animate-pulse rounded-[9px] bg-secondary" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              : voters.map((voter) => (
                  <TableRow key={voter.id}>
                    <TableCell>{voter.name}</TableCell>
                    <TableCell>{voter.branch ?? "-"}</TableCell>
                    <TableCell>{voter.voter_id ?? "-"}</TableCell>
                    <TableCell>{voter.voter_key ?? "-"}</TableCell>
                    <TableCell>
                      {voter.is_active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-slate-200 text-slate-700 hover:bg-slate-200">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-violet-200 text-violet-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800"
                          onClick={() => {
                            void handleOpenVoterQr(voter);
                          }}
                          aria-label={`View QR for ${voter.name}`}
                        >
                          <QrCode className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                          onClick={() => {
                            handleEditVoter(voter);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={deletingVoterId === voter.id}
                          onClick={() => {
                            handleDeleteVoter(voter);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

            {!loading && voters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No voters found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta?.current_page ?? 1} of {meta?.last_page ?? 1}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(meta && page >= meta.last_page)}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog
        open={Boolean(qrVoter)}
        onOpenChange={(open) => {
          if (!open) {
            setQrVoter(null);
            setQrCardDataUrl(null);
            setLoadingQrCard(false);
          }
        }}
      >
        <AlertDialogContent className="max-w-4xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="inline-flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              Voter QR Card
            </AlertDialogTitle>
            <AlertDialogDescription>
              {qrVoter ? (
                <>
                  {qrVoter.name} {qrVoter.branch ? `(${qrVoter.branch})` : ""} - Voter ID: {qrVoter.voter_id ?? "-"}
                </>
              ) : (
                "Preview voter QR card."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            {loadingQrCard ? (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="h-[420px] w-full animate-pulse rounded-md bg-secondary" />
              </div>
            ) : qrCardDataUrl ? (
              <div className="overflow-hidden rounded-lg border bg-muted/10 p-2">
                <img src={qrCardDataUrl} alt={`QR card for ${qrVoter?.name ?? "voter"}`} className="mx-auto w-full max-w-3xl rounded-md" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No QR preview available.</p>
            )}
          </div>

          <AlertDialogFooter>
            <Button type="button" onClick={() => void handleDownloadSingleQrCard()} disabled={loadingQrCard || !qrCardDataUrl}>
              <Download className="mr-2 h-4 w-4" />
              Download QR Card
            </Button>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteAllVotersOpen}
        onOpenChange={(open) => {
          if (!deletingAllVoters) {
            setDeleteAllVotersOpen(open);
          }
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Voters
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all users except:
              <br />
              <span className="font-semibold text-foreground">superadmin@voting.local</span>
              <br />
              <span className="font-semibold text-foreground">electionadmin@voting.local</span>
              <br />
              <span className="font-semibold text-foreground">voter@voting.local</span>
              <br />
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAllVoters}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingAllVoters}
              onClick={() => {
                void handleDeleteAllVoters();
              }}
            >
              {deletingAllVoters ? "Deleting..." : "Delete Voters"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(voterToDelete)}
        onOpenChange={(open) => {
          if (!open && deletingVoterId === null) {
            setVoterToDelete(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Voter
            </AlertDialogTitle>
            <AlertDialogDescription>
              Delete voter <span className="font-semibold text-foreground">&quot;{voterToDelete?.name}&quot;</span>? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingVoterId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingVoterId !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmDeleteVoter();
              }}
            >
              {deletingVoterId !== null ? "Deleting..." : "Delete Voter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
