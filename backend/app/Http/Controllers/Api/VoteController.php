<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Vote\StoreVoteRequest;
use App\Http\Resources\VoteReceiptResource;
use App\Models\Attendance;
use App\Models\Election;
use App\Models\User;
use App\Models\Vote;
use App\Services\AuditLogger;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class VoteController extends Controller
{
    public function store(StoreVoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        $election = Election::query()
            ->with(['positions', 'candidates'])
            ->findOrFail($data['election_id']);

        $this->authorize('create', [Vote::class, $election]);

        if (! $election->isOpen()) {
            return response()->json([
                'message' => 'Voting is not open for this election.',
            ], 422);
        }

        if ($election->hasEnded()) {
            return response()->json([
                'message' => 'Election has expired.',
            ], 422);
        }

        $user = $request->user();

        $isPresent = Attendance::query()
            ->where('election_id', $election->id)
            ->where('user_id', $user->id)
            ->where('status', 'present')
            ->exists();

        if (! $isPresent) {
            return response()->json([
                'message' => "{$user->name} is not marked present for this election. Attendance first to vote.",
            ], 403);
        }

        $voterHash = Vote::voterHash($user->id, $election->id);

        if (Vote::query()
            ->where('election_id', $election->id)
            ->where('voter_hash', $voterHash)
            ->exists()) {
            return response()->json([
                'message' => 'You have already voted in this election.',
            ], 409);
        }

        $positions = $election->positions->keyBy('id');
        $candidates = $election->candidates->keyBy('id');
        $votesByPosition = [];
        $selectionKeys = [];

        foreach ($data['votes'] as $selection) {
            $positionId = (int) $selection['position_id'];
            $candidateId = (int) $selection['candidate_id'];

            $position = $positions->get($positionId);
            $candidate = $candidates->get($candidateId);

            if (! $position) {
                return response()->json([
                    'message' => "Position {$positionId} does not belong to this election.",
                ], 422);
            }

            if (! $candidate || $candidate->position_id !== $positionId) {
                return response()->json([
                    'message' => "Candidate {$candidateId} is invalid for position {$positionId}.",
                ], 422);
            }

            $selectionKey = "{$positionId}:{$candidateId}";
            if (isset($selectionKeys[$selectionKey])) {
                return response()->json([
                    'message' => "Candidate {$candidateId} has been selected more than once for position {$positionId}.",
                ], 422);
            }

            $selectionKeys[$selectionKey] = true;
            $votesByPosition[$positionId][] = $candidateId;
        }

        foreach ($positions as $position) {
            $positionId = (int) $position->id;
            $selectedCount = count($votesByPosition[$positionId] ?? []);
            $minVotesAllowed = max(1, (int) $position->min_votes_allowed);
            $maxVotesAllowed = max($minVotesAllowed, (int) $position->max_votes_allowed);

            if ($selectedCount < $minVotesAllowed || $selectedCount > $maxVotesAllowed) {
                $constraintMessage = $minVotesAllowed === $maxVotesAllowed
                    ? "Position \"{$position->title}\" requires exactly {$minVotesAllowed} selection(s)."
                    : "Position \"{$position->title}\" requires between {$minVotesAllowed} and {$maxVotesAllowed} selection(s).";

                return response()->json([
                    'message' => $constraintMessage,
                ], 422);
            }
        }

        try {
            DB::transaction(function () use ($data, $election, $voterHash, $user): void {
                $lockedUser = User::query()
                    ->whereKey($user->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $currentElection = Election::query()
                    ->whereKey($election->id)
                    ->firstOrFail();

                if (! $currentElection->isOpen() || $currentElection->hasEnded()) {
                    throw ValidationException::withMessages([
                        'election' => ['Voting is not currently available for this election.'],
                    ]);
                }

                $isStillPresent = Attendance::query()
                    ->where('election_id', $currentElection->id)
                    ->where('user_id', $lockedUser->id)
                    ->where('status', 'present')
                    ->exists();

                if (! $isStillPresent) {
                    throw ValidationException::withMessages([
                        'election' => ['Attendance must be marked as present before voting.'],
                    ]);
                }

                if (Vote::query()
                    ->where('election_id', $currentElection->id)
                    ->where('voter_hash', $voterHash)
                    ->exists()) {
                    throw ValidationException::withMessages([
                        'election' => ['You have already voted in this election.'],
                    ]);
                }

                foreach ($data['votes'] as $selection) {
                    Vote::create([
                        'election_id' => $currentElection->id,
                        'position_id' => (int) $selection['position_id'],
                        'candidate_id' => (int) $selection['candidate_id'],
                        'voter_hash' => $voterHash,
                    ]);
                }

                $lockedUser->forceFill([
                    'already_voted' => true,
                ])->save();
            });
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (QueryException $exception) {
            return response()->json([
                'message' => 'Vote submission conflict detected. Please refresh and try again.',
            ], 409);
        }

        AuditLogger::log(
            $request,
            'vote.cast',
            "Vote submitted for election #{$election->id} by voter hash {$voterHash}."
        );

        return response()->json([
            'data' => new VoteReceiptResource([
                'election_id' => $election->id,
                'positions_voted' => count(array_unique(array_map(
                    static fn (array $selection): int => (int) $selection['position_id'],
                    $data['votes']
                ))),
                'submitted_at' => now()->toIso8601String(),
                'message' => 'Vote submitted successfully.',
            ]),
        ], 201);
    }
}
