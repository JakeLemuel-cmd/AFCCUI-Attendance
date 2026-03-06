<?php

namespace App\Http\Controllers\Api;

use App\Enums\ElectionStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Election\StoreElectionRequest;
use App\Http\Requests\Election\UpdateElectionRequest;
use App\Http\Resources\ElectionResource;
use App\Models\Election;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ElectionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isCompact = $request->boolean('compact');
        $query = Election::query()
            ->orderByDesc('created_at');

        if (! $isCompact) {
            $query->forDashboard();
        }

        if ($user->isElectionAdmin()) {
            $query->where('created_by', $user->id);
        }

        if ($user->isVoter()) {
            $query->whereIn('status', [
                ElectionStatus::OPEN->value,
                ElectionStatus::CLOSED->value,
            ]);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }

        $elections = $query->get();

        return response()->json([
            'data' => ElectionResource::collection($elections),
        ]);
    }

    public function store(StoreElectionRequest $request): JsonResponse
    {
        $this->authorize('create', Election::class);

        $isSuperAdmin = $request->user()->isSuperAdmin();
        $data = $request->validated();
        $startAt = Carbon::parse($data['start_datetime']);
        $endAt = Carbon::parse($data['end_datetime']);

        if (($data['status'] ?? ElectionStatus::DRAFT->value) === ElectionStatus::OPEN->value
            && ! $isSuperAdmin
            && now()->lt($startAt)) {
            return response()->json([
                'message' => 'Election cannot be opened before its start time.',
            ], 422);
        }

        if (($data['status'] ?? ElectionStatus::DRAFT->value) === ElectionStatus::OPEN->value
            && now()->gt($endAt)) {
            return response()->json([
                'message' => 'Election cannot be opened after its end time.',
            ], 422);
        }

        if (($data['status'] ?? null) === ElectionStatus::CLOSED->value) {
            return response()->json([
                'message' => 'Election cannot be created directly as closed.',
            ], 422);
        }

        $election = Election::create([
            ...$data,
            'status' => $data['status'] ?? ElectionStatus::DRAFT->value,
            'created_by' => $request->user()->id,
        ]);

        AuditLogger::log($request, 'election.create', "Election #{$election->id} created.");

        $election->load(['creator:id,name,email', 'positions.candidates'])->loadCount('votes');

        return response()->json([
            'data' => new ElectionResource($election),
        ], 201);
    }

    public function show(Election $election): JsonResponse
    {
        $this->authorize('view', $election);

        $election->load([
            'creator:id,name,email',
            'positions.candidates',
        ])->loadCount('votes');

        return response()->json([
            'data' => new ElectionResource($election),
        ]);
    }

    public function preview(Election $election): JsonResponse
    {
        if ($election->status !== ElectionStatus::DRAFT->value) {
            return response()->json([
                'message' => 'Election preview is only available while election is in draft mode.',
            ], 422);
        }

        $election->load([
            'creator:id,name,email',
            'positions.candidates',
        ])->loadCount('votes');

        $hasPreviewCandidates = $election->positions
            ->contains(fn ($position): bool => $position->candidates->isNotEmpty());

        if (! $hasPreviewCandidates) {
            return response()->json([
                'message' => 'Preview requires at least one position with at least one candidate.',
            ], 422);
        }

        return response()->json([
            'data' => new ElectionResource($election),
        ]);
    }

    public function update(UpdateElectionRequest $request, Election $election): JsonResponse
    {
        $this->authorize('update', $election);

        $isSuperAdmin = $request->user()->isSuperAdmin();

        if ($election->isClosed()) {
            return response()->json([
                'message' => 'Closed elections are locked and cannot be modified.',
            ], 422);
        }

        $data = $request->validated();

        if (isset($data['status'])) {
            if ($data['status'] === ElectionStatus::OPEN->value
                && ! $isSuperAdmin
                && now()->lt($election->start_datetime)) {
                return response()->json([
                    'message' => 'Election cannot be opened before its start time.',
                ], 422);
            }

            if ($data['status'] === ElectionStatus::OPEN->value && $election->hasEnded()) {
                return response()->json([
                    'message' => 'Election has expired and cannot be opened.',
                ], 422);
            }

            if ($data['status'] === ElectionStatus::OPEN->value
                && $election->status !== ElectionStatus::OPEN->value) {
                $openValidationMessage = $this->getOpenValidationMessage($election);

                if ($openValidationMessage !== null) {
                    return response()->json([
                        'message' => $openValidationMessage,
                    ], 422);
                }
            }
        }

        if (isset($data['start_datetime']) || isset($data['end_datetime'])) {
            $start = isset($data['start_datetime']) ? Carbon::parse($data['start_datetime']) : $election->start_datetime;
            $end = isset($data['end_datetime']) ? Carbon::parse($data['end_datetime']) : $election->end_datetime;

            if ($end->lte($start)) {
                return response()->json([
                    'message' => 'Election end time must be after start time.',
                ], 422);
            }

            $targetStatus = $data['status'] ?? $election->status;

            if ($targetStatus === ElectionStatus::OPEN->value
                && ! $isSuperAdmin
                && now()->lt($start)) {
                return response()->json([
                    'message' => 'Election cannot be open before its start time.',
                ], 422);
            }

            if ($targetStatus === ElectionStatus::OPEN->value && now()->gt($end)) {
                return response()->json([
                    'message' => 'Election cannot remain open past its end time.',
                ], 422);
            }
        }

        if (($data['status'] ?? null) === ElectionStatus::CLOSED->value) {
            $data['end_datetime'] = now();
        }

        $election->update($data);

        AuditLogger::log($request, 'election.update', "Election #{$election->id} updated.");

        $election->refresh()->load(['creator:id,name,email', 'positions.candidates'])->loadCount('votes');

        return response()->json([
            'data' => new ElectionResource($election),
        ]);
    }

    public function destroy(Request $request, Election $election): JsonResponse
    {
        $this->authorize('delete', $election);

        $canDeleteClosedElection = $request->user()->isSuperAdmin()
            && $election->status === ElectionStatus::CLOSED->value;

        if ($election->status !== ElectionStatus::DRAFT->value && ! $canDeleteClosedElection) {
            return response()->json([
                'message' => $election->status === ElectionStatus::CLOSED->value
                    ? 'Only super admins can delete closed elections.'
                    : 'Only draft elections can be deleted.',
            ], 422);
        }

        if ($election->votes()->exists()) {
            return response()->json([
                'message' => 'Election with votes cannot be deleted.',
            ], 422);
        }

        $electionId = $election->id;
        $election->delete();

        AuditLogger::log($request, 'election.delete', "Election #{$electionId} deleted.");

        return response()->json([
            'message' => 'Election deleted successfully.',
        ]);
    }

    private function getOpenValidationMessage(Election $election): ?string
    {
        $positions = $election->positions()
            ->select(['id', 'title', 'max_votes_allowed'])
            ->withCount('candidates')
            ->get();

        if ($positions->isEmpty()) {
            return 'Election cannot be opened because no positions are configured.';
        }

        $incompletePosition = $positions->first(
            fn ($position): bool => $position->candidates_count < $position->max_votes_allowed
        );

        if (! $incompletePosition) {
            return null;
        }

        $requiredSlots = (int) $incompletePosition->max_votes_allowed;
        $currentCandidates = (int) $incompletePosition->candidates_count;
        $slotLabel = $requiredSlots === 1 ? 'slot is' : 'slots are';
        $candidateLabel = $requiredSlots === 1 ? 'candidate' : 'candidates';

        return sprintf(
            '%s position %s not filled (%d/%d %s).',
            $incompletePosition->title,
            $slotLabel,
            $currentCandidates,
            $requiredSlots,
            $candidateLabel
        );
    }
}
