import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ellipsis, ImagePlus, Layers3, Pencil, Plus, Trash2, UserRound, Users } from "lucide-react";
import { createCandidate, deleteCandidate, getElection, updateCandidate } from "@/api/elections";
import { extractErrorMessage } from "@/api/client";
import type { Candidate, Election } from "@/api/types";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ActionAlert } from "@/components/ui/action-alert";
import { PageLoadingState } from "@/components/ui/loading-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import defaultAvatar from "@/assets/default-avatar.svg";

const candidateSchema = z.object({
  position_id: z.number().int().positive(),
  name: z.string().min(2, "Candidate name is required."),
  bio: z.string().optional(),
});

type CandidateFormData = z.infer<typeof candidateSchema>;

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:8000";
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function resolveCandidateImage(photoPath: string | null): string | null {
  if (!photoPath) {
    return null;
  }

  if (photoPath.startsWith("http://") || photoPath.startsWith("https://")) {
    try {
      const parsed = new URL(photoPath);
      if (parsed.pathname.startsWith("/storage/") && parsed.origin !== API_ORIGIN) {
        return `${API_ORIGIN}${parsed.pathname}`;
      }
    } catch {
      return photoPath;
    }

    return photoPath;
  }

  if (photoPath.startsWith("data:") || photoPath.startsWith("blob:")) {
    return photoPath;
  }

  if (photoPath.startsWith("/")) {
    return `${API_ORIGIN}${photoPath}`;
  }

  const normalized = photoPath.replace(/^\/+/, "");
  return normalized.startsWith("storage/")
    ? `${API_ORIGIN}/${normalized}`
    : `${API_ORIGIN}/storage/${normalized}`;
}

function CandidatePhoto({ name, photoPath }: { name: string; photoPath: string | null }) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = resolveCandidateImage(photoPath);

  if (!imageUrl || imageError) {
    return (
      <img
        src={defaultAvatar}
        alt={`${name} default avatar`}
        className="h-11 w-11 rounded-full border object-cover"
      />
    );
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      className="h-11 w-11 rounded-full border object-cover"
      onError={() => setImageError(true)}
    />
  );
}

export function AddCandidatesPage() {
  const params = useParams();
  const electionId = Number(params.id);
  const { user } = useAuth();

  const [election, setElection] = useState<Election | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoInputKey, setEditPhotoInputKey] = useState(0);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingCandidate, setDeletingCandidate] = useState<Candidate | null>(null);
  const [deletingSubmitting, setDeletingSubmitting] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const editPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CandidateFormData>({
    resolver: zodResolver(candidateSchema),
    defaultValues: {
      position_id: 0,
      name: "",
      bio: "",
    },
  });

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    watch: watchEdit,
    formState: { errors: editErrors },
  } = useForm<CandidateFormData>({
    resolver: zodResolver(candidateSchema),
    defaultValues: {
      position_id: 0,
      name: "",
      bio: "",
    },
  });

  const loadElection = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getElection(electionId);
      setElection(data);
      setError(null);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  const closeActionMenu = useCallback(() => {
    setOpenActionMenuId(null);
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!Number.isNaN(electionId)) {
      void loadElection();
    }
  }, [electionId, loadElection]);

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  useEffect(() => {
    return () => {
      if (editPhotoPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(editPhotoPreview);
      }
    };
  }, [editPhotoPreview]);

  useEffect(() => {
    if (openActionMenuId === null) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-candidate-actions-trigger]") || target?.closest("[data-candidate-actions-menu]")) {
        return;
      }

      closeActionMenu();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [closeActionMenu, openActionMenuId]);

  useEffect(() => {
    if (openActionMenuId === null) {
      return;
    }

    const handleViewportChange = () => {
      closeActionMenu();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeActionMenu, openActionMenuId]);

  const positionOptions = useMemo(() => {
    if (!election) {
      return [];
    }

    return election.positions.map((position) => ({
      value: String(position.id),
      label: `${position.title} (${position.candidates.length}/${position.max_votes_allowed})${
        position.candidates.length >= position.max_votes_allowed ? " - Full" : ""
      }`,
    }));
  }, [election]);

  const totalCandidates = useMemo(
    () => (election ? election.positions.reduce((sum, position) => sum + position.candidates.length, 0) : 0),
    [election]
  );

  const isOpenElectionLockedForRole = election?.status === "open" && user?.role !== "super_admin";

  const selectedCreatePositionId = watch("position_id");
  const selectedEditPositionId = watchEdit("position_id");

  const selectedCreatePosition = useMemo(
    () => election?.positions.find((position) => position.id === selectedCreatePositionId) ?? null,
    [election?.positions, selectedCreatePositionId]
  );

  const selectedEditPosition = useMemo(
    () => election?.positions.find((position) => position.id === selectedEditPositionId) ?? null,
    [election?.positions, selectedEditPositionId]
  );

  const selectedEditPositionCount = useMemo(() => {
    if (!selectedEditPosition) {
      return 0;
    }

    if (!editingCandidate || selectedEditPosition.id !== editingCandidate.position_id) {
      return selectedEditPosition.candidates.length;
    }

    return selectedEditPosition.candidates.filter((candidate) => candidate.id !== editingCandidate.id).length;
  }, [editingCandidate, selectedEditPosition]);

  const clearPhotoSelection = () => {
    if (photoPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(photoPreview);
    }

    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoInputKey((current) => current + 1);
  };

  const clearEditPhotoSelection = () => {
    if (editPhotoPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(editPhotoPreview);
    }

    setEditPhotoFile(null);
    setEditPhotoPreview(null);
    setEditPhotoInputKey((current) => current + 1);
  };

  const closeAddModal = () => {
    setAddModalOpen(false);
    reset({ position_id: 0, name: "", bio: "" });
    clearPhotoSelection();
    setError(null);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingCandidate(null);
    resetEdit({ position_id: 0, name: "", bio: "" });
    clearEditPhotoSelection();
    setError(null);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeletingCandidate(null);
    setError(null);
  };

  const openEditModal = (candidate: Candidate) => {
    setEditingCandidate(candidate);
    resetEdit({
      position_id: candidate.position_id,
      name: candidate.name,
      bio: candidate.bio ?? "",
    });
    clearEditPhotoSelection();
    setEditPhotoPreview(resolveCandidateImage(candidate.photo_path));
    setEditModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openDeleteModal = (candidate: Candidate) => {
    setDeletingCandidate(candidate);
    setDeleteModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      clearPhotoSelection();
      return;
    }

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("Photo must be JPG, PNG, or WEBP.");
      event.target.value = "";
      return;
    }

    if (photoPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(photoPreview);
    }

    setError(null);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleEditPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      clearEditPhotoSelection();
      if (editingCandidate) {
        setEditPhotoPreview(resolveCandidateImage(editingCandidate.photo_path));
      }
      return;
    }

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("Photo must be JPG, PNG, or WEBP.");
      event.target.value = "";
      return;
    }

    if (editPhotoPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(editPhotoPreview);
    }

    setError(null);
    setEditPhotoFile(file);
    setEditPhotoPreview(URL.createObjectURL(file));
  };

  const onSubmit = async (values: CandidateFormData) => {
    if (isOpenElectionLockedForRole) {
      setError("Only super admins can manage candidates while the election is open.");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setSubmitting(true);

      await createCandidate(electionId, {
        position_id: values.position_id,
        name: values.name,
        bio: values.bio ?? "",
        photo: photoFile,
      });

      reset({ position_id: 0, name: "", bio: "" });
      clearPhotoSelection();
      await loadElection();
      setSuccess("Candidate added successfully.");
      setAddModalOpen(false);
    } catch (createError) {
      setSuccess(null);
      setError(extractErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitEdit = async (values: CandidateFormData) => {
    if (!editingCandidate) {
      return;
    }

    if (isOpenElectionLockedForRole) {
      setError("Only super admins can manage candidates while the election is open.");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setEditingSubmitting(true);

      await updateCandidate(electionId, editingCandidate.id, {
        position_id: values.position_id,
        name: values.name,
        bio: values.bio ?? "",
        photo: editPhotoFile,
      });

      await loadElection();
      setSuccess("Candidate updated successfully.");
      closeEditModal();
    } catch (updateError) {
      setSuccess(null);
      setError(extractErrorMessage(updateError));
    } finally {
      setEditingSubmitting(false);
    }
  };

  const handleDeleteCandidate = async () => {
    if (!deletingCandidate) {
      return;
    }

    if (isOpenElectionLockedForRole) {
      setError("Only super admins can manage candidates while the election is open.");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setDeletingSubmitting(true);

      await deleteCandidate(electionId, deletingCandidate.id);
      await loadElection();
      setSuccess(`Candidate "${deletingCandidate.name}" deleted successfully.`);
      closeDeleteModal();
    } catch (deleteError) {
      setSuccess(null);
      setError(extractErrorMessage(deleteError));
    } finally {
      setDeletingSubmitting(false);
    }
  };

  const handleToggleActionMenu = (event: ReactMouseEvent<HTMLButtonElement>, candidateId: number) => {
    if (openActionMenuId === candidateId) {
      closeActionMenu();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 200;
    const viewportPadding = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)
    );

    setMenuPosition({
      top: rect.bottom + 8,
      left,
    });
    setOpenActionMenuId(candidateId);
  };

  const selectedCandidate = useMemo(() => {
    if (!election || openActionMenuId === null) {
      return null;
    }

    for (const position of election.positions) {
      const candidate = position.candidates.find((item) => item.id === openActionMenuId);
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }, [election, openActionMenuId]);

  const actionMenu =
    selectedCandidate && menuPosition
      ? createPortal(
          <div
            data-candidate-actions-menu
            className="animate-menu-pop fixed z-[80] w-48 origin-top-right rounded-xl border bg-card p-1 shadow-card"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <button
              type="button"
              className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isOpenElectionLockedForRole}
              title={
                isOpenElectionLockedForRole
                  ? "Only super admins can manage candidates while the election is open."
                  : undefined
              }
              onClick={() => {
                closeActionMenu();
                openEditModal(selectedCandidate);
              }}
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
              Edit Candidate
            </button>

            <button
              type="button"
              className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isOpenElectionLockedForRole}
              title={
                isOpenElectionLockedForRole
                  ? "Only super admins can manage candidates while the election is open."
                  : undefined
              }
              onClick={() => {
                closeActionMenu();
                openDeleteModal(selectedCandidate);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete Candidate
            </button>
          </div>,
          document.body
        )
      : null;

  if (loading) {
    return <PageLoadingState title="Loading candidates" subtitle="Fetching candidate roster and positions..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">Candidate Management - {election?.title ?? "Election"}</h2>
          <p className="text-sm text-muted-foreground">Add candidates via modal and monitor roster by position.</p>
        </div>
        <Button
          className="inline-flex items-center gap-2"
          disabled={isOpenElectionLockedForRole}
          title={
            isOpenElectionLockedForRole
              ? "Only super admins can manage candidates while the election is open."
              : undefined
          }
          onClick={() => {
            setAddModalOpen(true);
            setError(null);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Candidate
        </Button>
      </div>

      {success ? (
        <ActionAlert tone="success" message={success} autoHideMs={1000} onAutoHide={() => setSuccess(null)} />
      ) : null}
      {isOpenElectionLockedForRole ? (
        <ActionAlert
          tone="warning"
          message="This election is open. Candidate management is restricted to super admin accounts."
        />
      ) : null}
      {!addModalOpen && !editModalOpen && !deleteModalOpen && error ? <ActionAlert tone="error" message={error} /> : null}

      <AlertDialog
        open={addModalOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            closeAddModal();
            return;
          }

          if (open) {
            setAddModalOpen(true);
          }
        }}
      >
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Add Candidate</AlertDialogTitle>
            <AlertDialogDescription>Select position, upload photo, and provide candidate profile details.</AlertDialogDescription>
          </AlertDialogHeader>

          <form
            className="space-y-4"
            onSubmit={handleSubmit((values) => {
              void onSubmit(values);
            })}
          >
            <div className="space-y-2">
              <Label htmlFor="position_id">Position</Label>
              <Select
                id="position_id"
                options={positionOptions}
                placeholder="Select a position"
                disabled={isOpenElectionLockedForRole}
                {...register("position_id", { valueAsNumber: true })}
              />
              {errors.position_id ? <p className="text-sm text-destructive">{errors.position_id.message}</p> : null}
              {selectedCreatePosition ? (
                <p className="text-xs text-muted-foreground">
                  {selectedCreatePosition.candidates.length}/{selectedCreatePosition.max_votes_allowed} candidates assigned.
                </p>
              ) : null}
              {selectedCreatePosition &&
              selectedCreatePosition.candidates.length >= selectedCreatePosition.max_votes_allowed ? (
                <p className="text-sm text-destructive">
                  This position is full based on its maximum vote limit.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Candidate Name</Label>
              <Input id="name" disabled={isOpenElectionLockedForRole} {...register("name")} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="photo">Candidate Photo</Label>
              <div className="rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    key={photoInputKey}
                    ref={photoInputRef}
                    id="photo"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/*"
                    className="sr-only"
                    onChange={handlePhotoChange}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    disabled={isOpenElectionLockedForRole}
                    className="border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                    onClick={() => {
                      photoInputRef.current?.click();
                    }}
                  >
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Choose Photo
                  </Button>

                  <span className="text-sm text-muted-foreground">{photoFile ? photoFile.name : "No file selected"}</span>

                  {photoFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={clearPhotoSelection}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Accepted: JPG, PNG, WEBP.</p>

              <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed p-3">
                {photoPreview ? (
                  <img src={photoPreview} alt="Candidate preview" className="h-14 w-14 rounded-lg border object-cover" />
                ) : (
                  <img src={defaultAvatar} alt="Default avatar" className="h-14 w-14 rounded-lg border object-cover" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">{photoFile ? photoFile.name : "No photo selected"}</p>
                  <p className="text-xs text-muted-foreground">
                    {photoFile ? `${(photoFile.size / 1024).toFixed(1)} KB` : "Upload candidate profile picture"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea id="bio" rows={3} disabled={isOpenElectionLockedForRole} {...register("bio")} />
            </div>

            {error ? <ActionAlert tone="error" message={error} /> : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeAddModal} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || isOpenElectionLockedForRole}>
                {submitting ? "Saving..." : "Save Candidate"}
              </Button>
            </div>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={editModalOpen}
        onOpenChange={(open) => {
          if (!open && !editingSubmitting) {
            closeEditModal();
            return;
          }

          if (open) {
            setEditModalOpen(true);
          }
        }}
      >
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Candidate</AlertDialogTitle>
            <AlertDialogDescription>Update candidate details, position, and photo.</AlertDialogDescription>
          </AlertDialogHeader>

          <form
            className="space-y-4"
            onSubmit={handleSubmitEdit((values) => {
              void onSubmitEdit(values);
            })}
          >
            <div className="space-y-2">
              <Label htmlFor="edit_position_id">Position</Label>
              <Select
                id="edit_position_id"
                options={positionOptions}
                placeholder="Select a position"
                disabled={isOpenElectionLockedForRole}
                {...registerEdit("position_id", { valueAsNumber: true })}
              />
              {editErrors.position_id ? <p className="text-sm text-destructive">{editErrors.position_id.message}</p> : null}
              {selectedEditPosition ? (
                <p className="text-xs text-muted-foreground">
                  {selectedEditPositionCount}/{selectedEditPosition.max_votes_allowed} slots used for this selection.
                </p>
              ) : null}
              {selectedEditPosition && selectedEditPositionCount >= selectedEditPosition.max_votes_allowed ? (
                <p className="text-sm text-destructive">
                  This position is full based on its maximum vote limit.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_name">Candidate Name</Label>
              <Input id="edit_name" disabled={isOpenElectionLockedForRole} {...registerEdit("name")} />
              {editErrors.name ? <p className="text-sm text-destructive">{editErrors.name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_photo">Candidate Photo</Label>
              <div className="rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    key={editPhotoInputKey}
                    ref={editPhotoInputRef}
                    id="edit_photo"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/*"
                    className="sr-only"
                    onChange={handleEditPhotoChange}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    disabled={isOpenElectionLockedForRole}
                    className="border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                    onClick={() => {
                      editPhotoInputRef.current?.click();
                    }}
                  >
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Choose Photo
                  </Button>

                  <span className="text-sm text-muted-foreground">
                    {editPhotoFile ? editPhotoFile.name : "No new file selected"}
                  </span>

                  {editPhotoFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        clearEditPhotoSelection();
                        if (editingCandidate) {
                          setEditPhotoPreview(resolveCandidateImage(editingCandidate.photo_path));
                        }
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Accepted: JPG, PNG, WEBP.</p>

              <div className="mt-2 flex items-center gap-3 rounded-lg border border-dashed p-3">
                {editPhotoPreview ? (
                  <img src={editPhotoPreview} alt="Candidate preview" className="h-14 w-14 rounded-lg border object-cover" />
                ) : (
                  <img src={defaultAvatar} alt="Default avatar" className="h-14 w-14 rounded-lg border object-cover" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {editPhotoFile ? editPhotoFile.name : editingCandidate?.name ?? "No photo selected"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {editPhotoFile
                      ? `${(editPhotoFile.size / 1024).toFixed(1)} KB`
                      : editPhotoPreview
                        ? "Current candidate photo"
                        : "Upload candidate profile picture"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit_bio">Bio</Label>
              <Textarea id="edit_bio" rows={3} disabled={isOpenElectionLockedForRole} {...registerEdit("bio")} />
            </div>

            {error ? <ActionAlert tone="error" message={error} /> : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeEditModal} disabled={editingSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={editingSubmitting || isOpenElectionLockedForRole}>
                {editingSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteModalOpen}
        onOpenChange={(open) => {
          if (!open && !deletingSubmitting) {
            closeDeleteModal();
            return;
          }

          if (open) {
            setDeleteModalOpen(true);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Candidate</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingCandidate
                ? `Delete candidate "${deletingCandidate.name}"? This action cannot be undone.`
                : "Delete selected candidate? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? <ActionAlert tone="error" message={error} /> : null}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteModal} disabled={deletingSubmitting}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSubmitting || isOpenElectionLockedForRole}
              onClick={() => {
                void handleDeleteCandidate();
              }}
            >
              {deletingSubmitting ? "Deleting..." : "Delete Candidate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>Current Candidate Roster</CardTitle>
          <CardDescription>Organized by position with profile previews and quick totals.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Layers3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Positions</p>
                  <p className="text-2xl font-extrabold">{election?.positions.length ?? 0}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Candidates</p>
                  <p className="text-2xl font-extrabold">{totalCandidates}</p>
                </div>
              </div>
            </div>
          </div>

          {election?.positions.length ? (
            election.positions.map((position) => (
              <section key={position.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b bg-gradient-to-r from-secondary/70 via-secondary/30 to-transparent px-4 py-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-primary" />
                    <p className="font-semibold">{position.title}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">
                    {position.candidates.length} {position.candidates.length === 1 ? "Candidate" : "Candidates"}
                  </span>
                </div>

                <div className="p-4">
                  {position.candidates.length ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {position.candidates.map((candidate) => (
                        <article
                          key={candidate.id}
                          className="relative rounded-xl border bg-card p-3 text-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card"
                        >
                          <div data-candidate-actions-trigger className="absolute right-2 top-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              aria-label={`Open actions for ${candidate.name}`}
                              disabled={isOpenElectionLockedForRole}
                              title={
                                isOpenElectionLockedForRole
                                  ? "Only super admins can manage candidates while the election is open."
                                  : undefined
                              }
                              onClick={(event) => {
                                handleToggleActionMenu(event, candidate.id);
                              }}
                            >
                              <Ellipsis className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="flex items-start gap-3">
                            <CandidatePhoto name={candidate.name} photoPath={candidate.photo_path} />
                            <div className="min-w-0 pr-8">
                              <p className="truncate font-semibold">{candidate.name}</p>
                            </div>
                          </div>
                          <p className="mt-3 min-h-10 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
                            {candidate.bio ?? "No bio provided."}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No candidates added yet for this position.
                    </div>
                  )}
                </div>
              </section>
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No positions available for this election yet.
            </div>
          )}
        </CardContent>
      </Card>

      {actionMenu}
    </div>
  );
}
