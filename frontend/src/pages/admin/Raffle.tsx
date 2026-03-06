import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Shuffle, Trophy } from "lucide-react";
import { getAttendances } from "@/api/attendance";
import { extractErrorMessage } from "@/api/client";
import { getElections } from "@/api/elections";
import type { Attendance } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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

interface Participant {
  userId: number;
  attendanceId: number | null;
  name: string;
  branch: string | null;
}

interface WinnerRecord {
  userId: number;
  attendanceId: number | null;
  name: string;
  branch: string | null;
  pickedAt: string;
}

interface PrizeRecord {
  id: string;
  prizeName: string;
  totalWinners: number;
  createdAt: string;
}

type PrizeStorage = Record<string, PrizeRecord[]>;
type PrizeWinnersByPrize = Record<string, WinnerRecord[]>;
type PrizeWinnersStorage = Record<string, PrizeWinnersByPrize>;

const RAFFLE_PRIZES_STORAGE_KEY = "coopvote.raffle.prizes.v2";
const RAFFLE_PRIZE_WINNERS_STORAGE_KEY = "coopvote.raffle.prize_winners.v2";

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function downloadCsvFile(csvContent: string, fileName: string) {
  if (typeof window === "undefined") {
    return;
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function readPrizeStorage(): PrizeStorage {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(RAFFLE_PRIZES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as PrizeStorage;
  } catch {
    return {};
  }
}

function writePrizeStorage(storage: PrizeStorage) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RAFFLE_PRIZES_STORAGE_KEY, JSON.stringify(storage));
}

function readPrizeWinnersStorage(): PrizeWinnersStorage {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(RAFFLE_PRIZE_WINNERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as PrizeWinnersStorage;
  } catch {
    return {};
  }
}

function writePrizeWinnersStorage(storage: PrizeWinnersStorage) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RAFFLE_PRIZE_WINNERS_STORAGE_KEY, JSON.stringify(storage));
}

function getElectionPrizes(electionId: number): PrizeRecord[] {
  const storage = readPrizeStorage();
  return storage[String(electionId)] ?? [];
}

function saveElectionPrizes(electionId: number, prizes: PrizeRecord[]) {
  const storage = readPrizeStorage();
  storage[String(electionId)] = prizes;
  writePrizeStorage(storage);
}

function getElectionPrizeWinners(electionId: number): PrizeWinnersByPrize {
  const storage = readPrizeWinnersStorage();
  return storage[String(electionId)] ?? {};
}

function saveElectionPrizeWinners(electionId: number, winnersByPrize: PrizeWinnersByPrize) {
  const storage = readPrizeWinnersStorage();
  storage[String(electionId)] = winnersByPrize;
  writePrizeWinnersStorage(storage);
}

async function getAllPresentAttendances(electionId: number): Promise<Attendance[]> {
  const firstPage = await getAttendances({
    election_id: electionId,
    status: "present",
    page: 1,
    per_page: 200,
  });

  const rows: Attendance[] = [...firstPage.data];
  for (let page = 2; page <= firstPage.meta.last_page; page += 1) {
    const nextPage = await getAttendances({
      election_id: electionId,
      status: "present",
      page,
      per_page: 200,
    });
    rows.push(...nextPage.data);
  }

  return rows;
}

type RaffleView = "draw" | "winners";

interface RaffleProps {
  view?: RaffleView;
}

export function Raffle({ view = "draw" }: RaffleProps) {
  const isWinnersView = view === "winners";
  const [activeElectionId, setActiveElectionId] = useState<number | null>(null);
  const [presentRows, setPresentRows] = useState<Attendance[]>([]);
  const [prizes, setPrizes] = useState<PrizeRecord[]>([]);
  const [selectedPrizeId, setSelectedPrizeId] = useState<string>("");
  const [winnerViewPrizeId, setWinnerViewPrizeId] = useState<string>("");
  const [winnersByPrize, setWinnersByPrize] = useState<PrizeWinnersByPrize>({});
  const [showPrizeEditor, setShowPrizeEditor] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [resetWinnersConfirmOpen, setResetWinnersConfirmOpen] = useState(false);
  const [resetPrizesConfirmOpen, setResetPrizesConfirmOpen] = useState(false);
  const [prizeNameInput, setPrizeNameInput] = useState("");
  const [prizeCountInput, setPrizeCountInput] = useState("10");
  const [prizeError, setPrizeError] = useState<string | null>(null);
  const [spotlightName, setSpotlightName] = useState("-");
  const [latestWinner, setLatestWinner] = useState<WinnerRecord | null>(null);
  const [showFullscreenDraw, setShowFullscreenDraw] = useState(false);
  const [drawProgress, setDrawProgress] = useState<{ picked: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const animationIntervalRef = useRef<number | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const requestedFullscreenRef = useRef(false);

  const stopAnimation = useCallback(() => {
    if (animationIntervalRef.current !== null) {
      window.clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
  }, []);

  const clearDrawDisplay = useCallback(() => {
    setLatestWinner(null);
    setSpotlightName("-");
  }, []);

  const enterActualFullscreen = useCallback(() => {
    if (typeof document === "undefined" || document.fullscreenElement) {
      return;
    }

    void document.documentElement
      .requestFullscreen()
      .then(() => {
        requestedFullscreenRef.current = true;
      })
      .catch(() => {
        requestedFullscreenRef.current = false;
      });
  }, []);

  const exitActualFullscreen = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!document.fullscreenElement) {
      requestedFullscreenRef.current = false;
      return;
    }

    void document.exitFullscreen().finally(() => {
      requestedFullscreenRef.current = false;
    });
  }, []);

  useEffect(() => {
    return () => {
      stopAnimation();
      exitActualFullscreen();
    };
  }, [exitActualFullscreen, stopAnimation]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (typeof document === "undefined") {
        return;
      }

      if (!document.fullscreenElement) {
        requestedFullscreenRef.current = false;
        setShowFullscreenDraw(false);
        setDrawProgress(null);
        clearDrawDisplay();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [clearDrawDisplay]);

  useEffect(() => {
    if (!showFullscreenDraw && requestedFullscreenRef.current) {
      exitActualFullscreen();
    }
  }, [exitActualFullscreen, showFullscreenDraw]);

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

  const loadElections = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getElections();
      const available = data.filter((item) => item.status === "open" || item.status === "closed");

      if (available.length === 0) {
        setActiveElectionId(null);
        setPresentRows([]);
        setPrizes([]);
        setSelectedPrizeId("");
        setWinnerViewPrizeId("");
        setWinnersByPrize({});
        return;
      }

      setActiveElectionId((current) =>
        current && available.some((item) => item.id === current) ? current : available[0].id
      );
      setError(null);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPresentParticipants = useCallback(async (electionId: number) => {
    try {
      setLoading(true);
      const rows = await getAllPresentAttendances(electionId);
      setPresentRows(rows);
      setError(null);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
      setPresentRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadElections();
  }, [loadElections]);

  useEffect(() => {
    if (!activeElectionId) {
      setPrizes([]);
      setSelectedPrizeId("");
      setWinnerViewPrizeId("");
      setWinnersByPrize({});
      setLatestWinner(null);
      setSpotlightName("-");
      setShowFullscreenDraw(false);
      setDrawProgress(null);
      setShowPrizeEditor(false);
      setActionsMenuOpen(false);
      setResetWinnersConfirmOpen(false);
      setResetPrizesConfirmOpen(false);
      setPrizeError(null);
      return;
    }

    const storedPrizes = getElectionPrizes(activeElectionId);
    const storedWinners = getElectionPrizeWinners(activeElectionId);
    const firstPrizeId = isWinnersView ? "" : (storedPrizes[0]?.id || "");

    setPrizes(storedPrizes);
    setSelectedPrizeId(firstPrizeId);
    setWinnerViewPrizeId(firstPrizeId);
    setWinnersByPrize(storedWinners);
    setLatestWinner(null);
    setSpotlightName("-");
    setShowFullscreenDraw(false);
    setDrawProgress(null);
    setShowPrizeEditor(false);
    setActionsMenuOpen(false);
    setResetWinnersConfirmOpen(false);
    setResetPrizesConfirmOpen(false);
    setPrizeError(null);
    if (isWinnersView) {
      setPresentRows([]);
      return;
    }

    void loadPresentParticipants(activeElectionId);
  }, [activeElectionId, isWinnersView, loadPresentParticipants]);

  const participants = useMemo(() => {
    const unique = new Map<number, Participant>();
    for (const row of presentRows) {
      const userId = row.user_id;
      const userName = row.user?.name?.trim() ?? "";
      if (!userId || userName === "") {
        continue;
      }

      if (!unique.has(userId)) {
        unique.set(userId, {
          userId,
          attendanceId: typeof row.attendance_id === "number" ? row.attendance_id : null,
          name: userName,
          branch: row.user?.branch ?? null,
        });
      }
    }

    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [presentRows]);

  const selectedPrize = useMemo(
    () => prizes.find((prize) => prize.id === selectedPrizeId) ?? null,
    [prizes, selectedPrizeId]
  );

  const allPickedWinnerUserIds = useMemo(() => {
    const userIds = new Set<number>();
    Object.values(winnersByPrize).forEach((list) => {
      list.forEach((winner) => {
        userIds.add(winner.userId);
      });
    });
    return userIds;
  }, [winnersByPrize]);

  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !allPickedWinnerUserIds.has(participant.userId)),
    [participants, allPickedWinnerUserIds]
  );

  const selectedPrizeWinners = useMemo(() => {
    if (!selectedPrize) {
      return [];
    }
    return winnersByPrize[selectedPrize.id] ?? [];
  }, [selectedPrize, winnersByPrize]);

  const targetWinners = selectedPrize?.totalWinners ?? 0;
  const selectedPrizeRemainingSlots = Math.max(0, targetWinners - selectedPrizeWinners.length);
  const canDraw = Boolean(
    activeElectionId &&
      selectedPrize &&
      !drawing &&
      !loading &&
      selectedPrizeRemainingSlots > 0 &&
      eligibleParticipants.length > 0
  );

  const drawWinner = useCallback(async () => {
    if (!canDraw || !activeElectionId || !selectedPrize) {
      return;
    }

    setDrawing(true);
    setLatestWinner(null);
    setError(null);
    const winnersToPick = Math.min(selectedPrizeRemainingSlots, eligibleParticipants.length);
    const pickedWinners: WinnerRecord[] = [];
    let drawPool = [...eligibleParticipants];

    setDrawProgress({ picked: 0, total: winnersToPick });

    try {
      for (let drawIndex = 0; drawIndex < winnersToPick; drawIndex += 1) {
        if (drawPool.length === 0) {
          break;
        }

        const selected = await new Promise<Participant>((resolve) => {
          animationIntervalRef.current = window.setInterval(() => {
            const randomIndex = Math.floor(Math.random() * drawPool.length);
            setSpotlightName(drawPool[randomIndex].name);
          }, 90);

          animationTimeoutRef.current = window.setTimeout(() => {
            stopAnimation();
            const randomIndex = Math.floor(Math.random() * drawPool.length);
            resolve(drawPool[randomIndex]);
          }, 2200);
        });

        const winner: WinnerRecord = {
          userId: selected.userId,
          attendanceId: selected.attendanceId,
          name: selected.name,
          branch: selected.branch,
          pickedAt: new Date().toISOString(),
        };

        pickedWinners.push(winner);
        drawPool = drawPool.filter((participant) => participant.userId !== winner.userId);
        setSpotlightName(winner.name);
        setLatestWinner(winner);
        setDrawProgress({ picked: drawIndex + 1, total: winnersToPick });

        await new Promise((resolve) => {
          window.setTimeout(resolve, 450);
        });
      }

      if (pickedWinners.length > 0) {
        setWinnersByPrize((current) => {
          const currentPrizeWinners = current[selectedPrize.id] ?? [];
          const currentWinnerIds = new Set(currentPrizeWinners.map((item) => item.userId));
          const uniquePickedWinners = pickedWinners.filter((item) => !currentWinnerIds.has(item.userId));
          if (uniquePickedWinners.length === 0) {
            return current;
          }

          const nextPrizeWinners = [...uniquePickedWinners.reverse(), ...currentPrizeWinners];
          const next = {
            ...current,
            [selectedPrize.id]: nextPrizeWinners,
          };
          saveElectionPrizeWinners(activeElectionId, next);
          return next;
        });
      }
    } catch (drawError) {
      setError(extractErrorMessage(drawError));
    } finally {
      stopAnimation();
      setDrawProgress(null);
      setDrawing(false);
    }
  }, [
    activeElectionId,
    canDraw,
    eligibleParticipants,
    selectedPrize,
    selectedPrizeRemainingSlots,
    stopAnimation,
  ]);

  const handleSavePrize = useCallback(() => {
    if (!activeElectionId) {
      setPrizeError("No election available for raffle.");
      return;
    }

    const name = prizeNameInput.trim();
    const count = Number(prizeCountInput);
    if (name === "") {
      setPrizeError("Prize name is required.");
      return;
    }

    if (!Number.isInteger(count) || count <= 0) {
      setPrizeError("No. of winners must be a whole number greater than 0.");
      return;
    }

    const prize: PrizeRecord = {
      id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      prizeName: name,
      totalWinners: count,
      createdAt: new Date().toISOString(),
    };

    setPrizes((current) => {
      const next = [...current, prize];
      saveElectionPrizes(activeElectionId, next);
      return next;
    });
    setSelectedPrizeId(prize.id);
    setWinnerViewPrizeId(prize.id);
    setPrizeNameInput("");
    setPrizeCountInput("10");
    setPrizeError(null);
    setShowPrizeEditor(false);
    setActionsMenuOpen(false);
  }, [activeElectionId, prizeCountInput, prizeNameInput]);

  const handleResetWinners = useCallback(() => {
    if (!activeElectionId) {
      return;
    }

    setWinnersByPrize({});
    saveElectionPrizeWinners(activeElectionId, {});
    setLatestWinner(null);
    setSpotlightName("-");
    setShowFullscreenDraw(false);
    setDrawProgress(null);
    setResetWinnersConfirmOpen(false);
    setActionsMenuOpen(false);
  }, [activeElectionId]);

  const handleResetPrizes = useCallback(() => {
    if (!activeElectionId) {
      return;
    }

    setPrizes([]);
    setSelectedPrizeId("");
    setWinnerViewPrizeId("");
    setWinnersByPrize({});
    saveElectionPrizes(activeElectionId, []);
    saveElectionPrizeWinners(activeElectionId, {});
    setLatestWinner(null);
    setSpotlightName("-");
    setShowFullscreenDraw(false);
    setDrawProgress(null);
    setResetPrizesConfirmOpen(false);
    setActionsMenuOpen(false);
    setShowPrizeEditor(false);
    setPrizeError(null);
  }, [activeElectionId]);

  const handleExportWinners = useCallback(() => {
    if (!activeElectionId || prizes.length === 0) {
      return;
    }

    const header = "Prize Name,Winner Name";
    const rows = prizes.flatMap((prize) => {
      const prizeWinners = winnersByPrize[prize.id] ?? [];
      return prizeWinners.map((winner) =>
        [escapeCsvCell(prize.prizeName), escapeCsvCell(winner.name)].join(",")
      );
    });
    const csv = [header, ...rows].join("\n");
    downloadCsvFile(csv, `raffle_winners_election_${activeElectionId}.csv`);
    setActionsMenuOpen(false);
  }, [activeElectionId, prizes, winnersByPrize]);

  const hasAnyWinners = useMemo(
    () => Object.values(winnersByPrize).some((winnerList) => winnerList.length > 0),
    [winnersByPrize]
  );

  const prizesForWinnerView = useMemo(
    () => (isWinnersView ? prizes.filter((prize) => (winnersByPrize[prize.id] ?? []).length > 0) : prizes),
    [isWinnersView, prizes, winnersByPrize]
  );

  useEffect(() => {
    if (winnerViewPrizeId === "") {
      return;
    }

    const hasSelected = prizesForWinnerView.some((prize) => prize.id === winnerViewPrizeId);
    if (!hasSelected) {
      setWinnerViewPrizeId("");
    }
  }, [prizesForWinnerView, winnerViewPrizeId]);

  return (
    <div className="space-y-6">
      {!isWinnersView ? (
        <>
          <Card>
            <CardHeader className="gap-3 md:flex md:flex-row md:items-start md:justify-between">
              <div className="w-full max-w-md space-y-3">
                <div className="space-y-1">
                  <CardTitle>Raffle Draw</CardTitle>
                  <CardDescription>Only present attendees are eligible. A selected winner cannot be picked again.</CardDescription>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="raffle-prize-select">Saved Prizes</Label>
                  <Select
                    id="raffle-prize-select"
                    value={selectedPrizeId}
                    onChange={(event) => {
                      const prizeId = event.target.value;
                      setSelectedPrizeId(prizeId);
                      if (prizeId) {
                        setWinnerViewPrizeId(prizeId);
                      }
                      setLatestWinner(null);
                    }}
                    options={prizes.map((prize) => ({
                      value: prize.id,
                      label: `Top ${prize.totalWinners} - ${prize.prizeName}`,
                      disabled: (winnersByPrize[prize.id] ?? []).length > 0,
                    }))}
                    placeholder={prizes.length > 0 ? "Select prize" : "No prizes yet"}
                    disabled={drawing || loading || prizes.length === 0}
                  />
                  <p className="text-xs text-muted-foreground">Prizes with picked winners are greyed out.</p>
                </div>
              </div>

              <div className="relative" ref={actionsMenuRef}>
                <Button
                  type="button"
                  variant="outline"
                  className="px-4"
                  onClick={() => {
                    setActionsMenuOpen((current) => !current);
                    setPrizeError(null);
                  }}
                  disabled={drawing || loading || !activeElectionId}
                >
                  ...
                </Button>

                {actionsMenuOpen ? (
                  <div className="absolute right-0 z-20 mt-2 w-52 rounded-md border bg-card p-1 shadow-lg">
                    <button
                      type="button"
                      className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setShowPrizeEditor((current) => !current);
                        setPrizeError(null);
                        setActionsMenuOpen(false);
                      }}
                    >
                      Add Prize
                    </button>
                    <button
                      type="button"
                      className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={drawing || loading || !hasAnyWinners}
                      onClick={handleExportWinners}
                    >
                      Export Winners
                    </button>
                    <button
                      type="button"
                      className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={drawing || loading || prizes.length === 0}
                      onClick={() => {
                        setResetPrizesConfirmOpen(true);
                        setActionsMenuOpen(false);
                      }}
                    >
                      Reset Prizes
                    </button>
                    <button
                      type="button"
                      className="inline-flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={drawing || loading || !hasAnyWinners}
                      onClick={() => {
                        setResetWinnersConfirmOpen(true);
                        setActionsMenuOpen(false);
                      }}
                    >
                      Reset Winners
                    </button>
                  </div>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {showPrizeEditor ? (
                <div className="rounded-md border bg-muted/10 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="raffle-prize-name">Prize Name</Label>
                      <Input
                        id="raffle-prize-name"
                        value={prizeNameInput}
                        onChange={(event) => setPrizeNameInput(event.target.value)}
                        placeholder="e.g. electric fan"
                        disabled={drawing}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="raffle-winner-count">No. of Winners</Label>
                      <Input
                        id="raffle-winner-count"
                        type="number"
                        min={1}
                        step={1}
                        value={prizeCountInput}
                        onChange={(event) => setPrizeCountInput(event.target.value)}
                        placeholder="10"
                        disabled={drawing}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={handleSavePrize} disabled={drawing}>
                      Save Prize
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowPrizeEditor(false);
                        setPrizeError(null);
                      }}
                      disabled={drawing}
                    >
                      Cancel
                    </Button>
                  </div>
                  {prizeError ? <p className="mt-2 text-sm text-destructive">{prizeError}</p> : null}
                </div>
              ) : null}

              <div className="rounded-xl border bg-gradient-to-br from-primary/[0.08] via-card to-card p-6 text-center">
                {selectedPrize ? (
                  <div className="mb-3 space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Top {selectedPrize.totalWinners} winners of {selectedPrize.prizeName}
                    </p>
                  </div>
                ) : (
                  <p className="mb-3 text-sm text-muted-foreground">Add and select a prize first.</p>
                )}

                <p className="mt-3 min-h-[44px] text-3xl font-extrabold tracking-tight text-foreground">{spotlightName}</p>

                {latestWinner ? (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-700">
                    <Trophy className="h-4 w-4" />
                    <span className="text-sm font-semibold">Winner: {latestWinner.name}</span>
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {selectedPrize ? (
                    <Button
                      type="button"
                      size="lg"
                      className="h-14 min-w-[220px] text-lg font-semibold"
                      onClick={() => {
                        setShowFullscreenDraw(true);
                        setDrawProgress(null);
                        enterActualFullscreen();
                      }}
                      disabled={!canDraw}
                    >
                      <Shuffle className="mr-2 h-4 w-4" />
                      Pick Winner
                    </Button>
                  ) : null}
                </div>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {!loading && activeElectionId && participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No present attendees found for this election.</p>
              ) : null}
              {!loading && selectedPrize && selectedPrizeRemainingSlots <= 0 ? (
                <p className="text-sm text-muted-foreground">
                  Target reached for "{selectedPrize.prizeName}".
                </p>
              ) : null}
            </CardContent>
          </Card>

          {showFullscreenDraw ? (
            <div className="fixed inset-0 z-50 flex h-screen w-screen bg-background">
              <div className="flex h-full w-full flex-1 flex-col bg-card p-4 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm uppercase tracking-[0.14em] text-muted-foreground">Fullscreen Draw</p>
                    {selectedPrize ? (
                      <p className="text-xl font-semibold text-foreground">
                        Top {selectedPrize.totalWinners} winners of {selectedPrize.prizeName}
                      </p>
                    ) : null}
                    {drawProgress ? (
                      <p className="text-sm text-muted-foreground">
                        Picking winner {drawProgress.picked} of {drawProgress.total}
                      </p>
                    ) : selectedPrize ? (
                      <p className="text-sm text-muted-foreground">
                        Winners remaining: {selectedPrizeRemainingSlots}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!drawing) {
                        setShowFullscreenDraw(false);
                        setDrawProgress(null);
                        clearDrawDisplay();
                        exitActualFullscreen();
                      }
                    }}
                    disabled={drawing}
                  >
                    Close
                  </Button>
                </div>

                <div className="mt-6 flex flex-1 flex-col gap-4 lg:flex-row">
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <p className="min-h-[120px] text-5xl font-black tracking-tight text-foreground sm:text-7xl lg:text-8xl">
                      {spotlightName}
                    </p>

                    {latestWinner ? (
                      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-emerald-700">
                        <Trophy className="h-5 w-5" />
                        <span className="text-base font-semibold">Winner: {latestWinner.name}</span>
                      </div>
                    ) : null}

                    <Button
                      type="button"
                      size="lg"
                      className="mt-10 h-16 min-w-[260px] text-2xl font-semibold"
                      onClick={() => {
                        void drawWinner();
                      }}
                      disabled={!canDraw}
                    >
                      <Shuffle className="mr-3 h-6 w-6" />
                      {drawing ? "Drawing..." : "Pick Winner"}
                    </Button>
                  </div>

                  {selectedPrizeWinners.length > 0 ? (
                    <aside className="w-full shrink-0 lg:w-[360px]">
                      <div className="rounded-md border bg-muted/10 p-3">
                        <p className="text-sm font-semibold text-foreground">Picked Winners</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedPrize?.prizeName ?? "Prize"} | {selectedPrizeWinners.length} winner(s)
                        </p>
                      </div>
                      <div className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                        {selectedPrizeWinners.map((winner, index) => (
                          <div key={`${winner.userId}-${winner.pickedAt}`} className="rounded-md border px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold text-foreground">{winner.name}</p>
                              <Badge variant="secondary">#{index + 1}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {winner.branch ?? "-"} | Picked {new Date(winner.pickedAt).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </aside>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {isWinnersView ? (
        <Card>
          <CardHeader>
            <CardTitle>Winners</CardTitle>
            <CardDescription>Click a prize name to view its winner list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prizesForWinnerView.length === 0 ? (
              <p className="text-sm text-muted-foreground">No winners yet for any prize.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                {prizesForWinnerView.map((prize) => {
                  const isOpen = winnerViewPrizeId === prize.id;
                  const prizeWinners = winnersByPrize[prize.id] ?? [];

                  return (
                    <div key={prize.id} className="border-b last:border-b-0">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                        onClick={() => {
                          setWinnerViewPrizeId((current) => (current === prize.id ? "" : prize.id));
                        }}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{prize.prizeName}</p>
                          <p className="text-xs text-muted-foreground">
                            Top {prize.totalWinners} | Winners: {prizeWinners.length}
                          </p>
                        </div>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>

                      {isOpen ? (
                        <div className="border-t bg-muted/5 px-3 py-2">
                          {prizeWinners.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No winners yet for this prize.</p>
                          ) : (
                            <div className="divide-y">
                              {prizeWinners.map((winner, index) => (
                                <div key={`${winner.userId}-${winner.pickedAt}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-foreground">{winner.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {winner.branch ?? "-"} | Picked {new Date(winner.pickedAt).toLocaleString()}
                                    </p>
                                  </div>
                                  <Badge variant="secondary">#{index + 1}</Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isWinnersView ? (
        <>
          <AlertDialog open={resetWinnersConfirmOpen} onOpenChange={setResetWinnersConfirmOpen}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">Reset Winners</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all picked winners for the current election. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={drawing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
                  onClick={handleResetWinners}
                  disabled={drawing}
                >
                  Delete Winners
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={resetPrizesConfirmOpen} onOpenChange={setResetPrizesConfirmOpen}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">Reset Prizes</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all saved prizes and their winner lists for the current election. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={drawing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
                  onClick={handleResetPrizes}
                  disabled={drawing}
                >
                  Delete Prizes
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
