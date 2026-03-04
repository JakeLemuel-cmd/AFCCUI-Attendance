<?php

namespace App\Http\Controllers\Api;

use App\Enums\AttendanceStatus;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Election;
use App\Models\User;
use App\Models\Vote;
use App\Services\AuditLogger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class AttendanceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['nullable', 'integer', 'exists:elections,id'],
            'search' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'in:present,absent'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        $electionId = isset($data['election_id']) ? (int) $data['election_id'] : null;
        $electionTitle = null;
        if ($electionId !== null) {
            $electionTitle = Election::query()
                ->whereKey($electionId)
                ->value('title');
        }

        $baseQuery = User::query()
            ->select([
                'id',
                'name',
                'branch',
                'voter_id',
                'attendance_status',
                'already_voted',
                'created_at',
                'updated_at',
            ])
            ->where('role', UserRole::VOTER->value)
            ->orderBy('name')
            ->orderBy('id');
        $this->applyProtectedVoterExclusion($baseQuery);

        $search = isset($data['search']) ? trim((string) $data['search']) : '';
        if ($search !== '') {
            $baseQuery->where(function ($builder) use ($search): void {
                $builder->where('name', 'like', '%'.$search.'%')
                    ->orWhere('voter_id', 'like', '%'.$search.'%')
                    ->orWhere('branch', 'like', '%'.$search.'%');
            });
        }

        $query = clone $baseQuery;
        if (! empty($data['status'])) {
            $this->applyAttendanceStatusFilter($query, $electionId, (string) $data['status']);
        }

        $totalCount = (clone $baseQuery)->count();
        if ($electionId !== null) {
            $presentQuery = clone $baseQuery;
            $this->applyAttendanceStatusFilter($presentQuery, $electionId, AttendanceStatus::PRESENT->value);
            $presentCount = $presentQuery->count();
            $absentCount = max(0, $totalCount - $presentCount);
        } else {
            $presentCount = (clone $baseQuery)
                ->where('attendance_status', AttendanceStatus::PRESENT->value)
                ->count();
            $absentCount = (clone $baseQuery)
                ->where('attendance_status', AttendanceStatus::ABSENT->value)
                ->count();
        }

        $voters = $query->paginate((int) ($data['per_page'] ?? 25));
        $voterCollection = $voters->getCollection();
        $alreadyVotedByUserId = $this->alreadyVotedByUserId($voterCollection, $electionId);

        $attendanceByUserId = collect();
        if ($electionId !== null && $voterCollection->isNotEmpty()) {
            $attendanceByUserId = Attendance::query()
                ->where('election_id', $electionId)
                ->whereIn('user_id', $voterCollection->pluck('id')->all())
                ->get()
                ->keyBy('user_id');
        }

        $rows = $voterCollection->map(
            fn (User $voter): array => $this->toAttendanceRow(
                $voter,
                $electionId,
                $electionTitle,
                'manual',
                null,
                $attendanceByUserId->get($voter->id),
                $alreadyVotedByUserId[$voter->id] ?? null
            )
        )->values()->all();

        return response()->json([
            'data' => $rows,
            'meta' => [
                'current_page' => $voters->currentPage(),
                'last_page' => $voters->lastPage(),
                'per_page' => $voters->perPage(),
                'total' => $voters->total(),
            ],
            'summary' => [
                'total' => $totalCount,
                'present' => $presentCount,
                'absent' => $absentCount,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
            'voter_id' => ['required', 'string', 'max:100'],
            'status' => ['required', 'in:present,absent'],
            'checked_in_at' => ['nullable', 'date'],
        ]);

        $voterId = trim((string) $data['voter_id']);
        $voter = User::query()
            ->where('role', UserRole::VOTER->value)
            ->where('voter_id', $voterId)
            ->first();

        if (! $voter) {
            return response()->json([
                'message' => 'No user registered',
            ], 422);
        }

        if ($this->isProtectedAttendanceVoter($voter)) {
            return response()->json([
                'message' => 'This voter is excluded from attendance.',
            ], 422);
        }

        $status = (string) $data['status'];
        $electionId = (int) $data['election_id'];
        $checkedInAt = $status === AttendanceStatus::PRESENT->value
            ? (isset($data['checked_in_at']) ? Carbon::parse((string) $data['checked_in_at']) : now())
            : null;

        [$alreadyPresent, $attendance] = DB::transaction(function () use ($voter, $electionId, $status, $checkedInAt): array {
            $lockedVoter = User::query()
                ->whereKey($voter->id)
                ->lockForUpdate()
                ->firstOrFail();

            $attendance = Attendance::query()
                ->where('election_id', $electionId)
                ->where('user_id', $lockedVoter->id)
                ->lockForUpdate()
                ->first();

            $isAlreadyPresent = $attendance?->status === AttendanceStatus::PRESENT->value;
            if ($status === AttendanceStatus::PRESENT->value && $isAlreadyPresent) {
                return [true, $attendance];
            }

            if ($attendance) {
                $attendance->forceFill([
                    'status' => $status,
                    'checked_in_at' => $status === AttendanceStatus::PRESENT->value ? $checkedInAt : null,
                    'source' => 'manual',
                ])->save();
            } else {
                $attendance = Attendance::query()->create([
                    'election_id' => $electionId,
                    'user_id' => $lockedVoter->id,
                    'status' => $status,
                    'checked_in_at' => $status === AttendanceStatus::PRESENT->value ? $checkedInAt : null,
                    'source' => 'manual',
                ]);
            }

            $lockedVoter->forceFill([
                'attendance_status' => $status,
            ])->save();

            return [false, $attendance];
        });

        if ($alreadyPresent) {
            return response()->json([
                'message' => "{$voter->name} is already marked as present",
            ], 409);
        }
        $electionTitle = Election::query()
            ->whereKey($electionId)
            ->value('title');
        $freshVoter = $voter->fresh() ?? $voter;
        $alreadyVotedByUserId = $this->alreadyVotedByUserId(new EloquentCollection([$freshVoter]), $electionId);

        AuditLogger::log(
            $request,
            'attendance.upsert',
            "Attendance updated for voter #{$voter->id} in election #{$electionId}."
        );

        return response()->json([
            'message' => $status === AttendanceStatus::PRESENT->value
                ? "{$voter->name} is now marked as present in attendance."
                : "Attendance updated for {$voter->name}",
            'data' => $this->toAttendanceRow(
                $freshVoter,
                $electionId,
                $electionTitle,
                'manual',
                $checkedInAt?->toIso8601String(),
                $attendance?->fresh(),
                $alreadyVotedByUserId[$freshVoter->id] ?? null
            ),
        ], 201);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
        ]);

        if (! $user->isVoter()) {
            return response()->json([
                'message' => 'Attendance deletion is limited to voter accounts.',
            ], 422);
        }

        if ($this->isProtectedAttendanceVoter($user)) {
            return response()->json([
                'message' => 'This voter is excluded from attendance.',
            ], 422);
        }

        $electionId = (int) $data['election_id'];
        $electionTitle = Election::query()
            ->whereKey($electionId)
            ->value('title');

        $deleted = DB::transaction(function () use ($user, $electionId): bool {
            $lockedUser = User::query()
                ->whereKey($user->id)
                ->lockForUpdate()
                ->firstOrFail();

            $attendance = Attendance::query()
                ->where('election_id', $electionId)
                ->where('user_id', $lockedUser->id)
                ->lockForUpdate()
                ->first();

            if (! $attendance) {
                return false;
            }

            $attendance->delete();

            $hasPresentAttendance = Attendance::query()
                ->where('user_id', $lockedUser->id)
                ->where('status', AttendanceStatus::PRESENT->value)
                ->exists();

            $lockedUser->forceFill([
                'attendance_status' => $hasPresentAttendance
                    ? AttendanceStatus::PRESENT->value
                    : AttendanceStatus::ABSENT->value,
            ])->save();

            return true;
        });

        if (! $deleted) {
            return response()->json([
                'message' => 'No attendance record was found for this voter in the selected election.',
            ], 404);
        }

        $freshVoter = $user->fresh() ?? $user;
        $alreadyVotedByUserId = $this->alreadyVotedByUserId(new EloquentCollection([$freshVoter]), $electionId);

        AuditLogger::log(
            $request,
            'attendance.delete',
            "Attendance deleted for voter #{$user->id} in election #{$electionId}."
        );

        return response()->json([
            'message' => 'Attendance record deleted successfully.',
            'data' => $this->toAttendanceRow(
                $freshVoter,
                $electionId,
                $electionTitle,
                'manual',
                null,
                null,
                $alreadyVotedByUserId[$freshVoter->id] ?? null
            ),
        ]);
    }

    public function destroyMany(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
            'confirmation' => ['required', 'string', 'max:50'],
        ]);

        if (strtoupper(trim((string) $data['confirmation'])) !== 'DELETE ALL') {
            return response()->json([
                'message' => 'Confirmation text must be exactly "DELETE ALL".',
            ], 422);
        }

        $electionId = (int) $data['election_id'];
        $protectedEmails = $this->bulkDeleteProtectedEmails();
        $protectedVoterIds = User::query()
            ->where('role', UserRole::VOTER->value)
            ->whereNotNull('email')
            ->where(function (Builder $query) use ($protectedEmails): void {
                foreach ($protectedEmails as $email) {
                    $query->orWhereRaw('LOWER(email) = ?', [Str::lower($email)]);
                }
            })
            ->pluck('id')
            ->map(fn ($userId): int => (int) $userId)
            ->all();

        if (count($protectedVoterIds) === 0) {
            return response()->json([
                'message' => 'No protected voter account was found. Bulk delete was cancelled.',
            ], 422);
        }

        [$deletedCount, $deletedUserCount, $affectedUserCount] = DB::transaction(function () use ($electionId, $protectedVoterIds): array {
            $affectedUserIds = Attendance::query()
                ->where('election_id', $electionId)
                ->select('user_id')
                ->distinct()
                ->pluck('user_id')
                ->map(fn ($userId): int => (int) $userId)
                ->all();

            $deletedCount = Attendance::query()
                ->where('election_id', $electionId)
                ->delete();

            if ($affectedUserIds !== []) {
                User::query()
                    ->whereIn('id', $affectedUserIds)
                    ->update([
                        'attendance_status' => AttendanceStatus::ABSENT->value,
                    ]);

                $remainingPresentUserIds = Attendance::query()
                    ->whereIn('user_id', $affectedUserIds)
                    ->where('status', AttendanceStatus::PRESENT->value)
                    ->select('user_id')
                    ->distinct()
                    ->pluck('user_id')
                    ->map(fn ($userId): int => (int) $userId)
                    ->all();

                if ($remainingPresentUserIds !== []) {
                    User::query()
                        ->whereIn('id', $remainingPresentUserIds)
                        ->update([
                            'attendance_status' => AttendanceStatus::PRESENT->value,
                        ]);
                }
            }

            $deleteUserQuery = User::query()
                ->where('role', UserRole::VOTER->value)
                ->whereNotIn('id', $protectedVoterIds);
            $deletedUserCount = (int) (clone $deleteUserQuery)->count();

            if ($deletedUserCount > 0) {
                $deleteUserQuery->delete();
            }

            return [$deletedCount, $deletedUserCount, count($affectedUserIds)];
        });

        if ($deletedCount === 0 && $deletedUserCount === 0) {
            return response()->json([
                'message' => 'No attendance records or voter accounts found to delete.',
                'meta' => [
                    'deleted' => 0,
                    'affected_voters' => 0,
                    'deleted_users' => 0,
                    'protected_accounts' => $protectedEmails,
                ],
            ], 200);
        }

        AuditLogger::log(
            $request,
            'attendance.bulk_delete',
            "Bulk attendance delete completed for election #{$electionId}. Attendance deleted: {$deletedCount}, Voters deleted: {$deletedUserCount}, Affected voters: {$affectedUserCount}."
        );

        return response()->json([
            'message' => 'Attendance records were deleted and voter accounts were cleaned up. Protected accounts were kept.',
            'meta' => [
                'deleted' => $deletedCount,
                'affected_voters' => $affectedUserCount,
                'deleted_users' => $deletedUserCount,
                'protected_accounts' => $protectedEmails,
            ],
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['nullable', 'integer', 'exists:elections,id'],
            'file' => ['required', 'file', 'mimes:csv,txt', 'max:5120'],
            'continue_on_error' => ['nullable', 'boolean'],
        ]);
        $electionId = isset($data['election_id']) ? (int) $data['election_id'] : null;
        $continueOnError = $request->boolean('continue_on_error', true);

        /** @var UploadedFile $file */
        $file = $request->file('file');
        $rows = $this->readCsvFile($file);

        if (count($rows) < 2) {
            return response()->json([
                'message' => 'The CSV file must include a header row and at least one attendance row.',
            ], 422);
        }

        $headers = array_map(
            fn ($header): string => Str::snake(trim((string) preg_replace('/^\xEF\xBB\xBF/', '', (string) $header))),
            $rows[0]
        );

        if (! in_array('name', $headers, true)) {
            return response()->json([
                'message' => 'CSV must contain a NAME column.',
            ], 422);
        }

        $payloads = [];
        $errors = [];

        foreach (array_slice($rows, 1) as $index => $rowValues) {
            $line = $index + 2;
            $row = [];

            foreach ($headers as $position => $header) {
                $row[$header] = isset($rowValues[$position]) ? trim((string) $rowValues[$position]) : null;
            }

            $isEmptyRow = collect($row)->every(fn ($value): bool => $value === null || $value === '');
            if ($isEmptyRow) {
                continue;
            }

            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                $errors[] = [
                    'line' => $line,
                    'message' => 'NAME is required.',
                ];

                continue;
            }

            $normalizedName = preg_replace('/\s+/', ' ', $name);
            $normalizedName = is_string($normalizedName) ? trim($normalizedName) : $name;

            $matchedVotersQuery = User::query()
                ->select(['id'])
                ->where('role', UserRole::VOTER->value);
            $this->applyProtectedVoterExclusion($matchedVotersQuery);

            $matchedVoters = $matchedVotersQuery
                ->whereRaw('LOWER(TRIM(name)) = ?', [Str::lower($normalizedName)])
                ->limit(2)
                ->get();

            if ($matchedVoters->isEmpty()) {
                $errors[] = [
                    'line' => $line,
                    'message' => 'Voter name was not found.',
                ];

                continue;
            }

            if ($matchedVoters->count() > 1) {
                $errors[] = [
                    'line' => $line,
                    'message' => 'Multiple voters matched NAME. Please use a unique voter name.',
                ];

                continue;
            }

            $payloads[] = [
                'user_id' => (int) $matchedVoters->first()->id,
                'status' => AttendanceStatus::PRESENT->value,
            ];
        }

        $skipped = count($errors);

        if (count($errors) > 0 && ! $continueOnError) {
            return response()->json([
                'message' => 'Attendance import failed due to CSV validation errors.',
                'errors' => $errors,
            ], 422);
        }

        $updated = 0;

        DB::transaction(function () use ($payloads, $electionId, &$updated): void {
            foreach ($payloads as $payload) {
                if ($electionId !== null) {
                    Attendance::query()->updateOrCreate(
                        [
                            'election_id' => $electionId,
                            'user_id' => $payload['user_id'],
                        ],
                        [
                            'status' => $payload['status'],
                            'checked_in_at' => $payload['status'] === AttendanceStatus::PRESENT->value ? now() : null,
                            'source' => 'import',
                        ]
                    );
                }

                $affected = User::query()
                    ->whereKey($payload['user_id'])
                    ->update([
                        'attendance_status' => $payload['status'],
                    ]);

                if ($affected > 0) {
                    $updated++;
                }
            }
        });

        AuditLogger::log(
            $request,
            'attendance.import',
            "Attendance import completed for election #".($electionId ?? 0).". Updated: {$updated}, Processed: ".count($payloads).", Skipped: {$skipped}."
        );

        return response()->json([
            'message' => $continueOnError && $skipped > 0
                ? 'Attendance imported with skipped rows. Review errors for details.'
                : 'Attendance imported successfully.',
            'meta' => [
                'created' => 0,
                'updated' => $updated,
                'total_processed' => count($payloads),
                'skipped' => $skipped,
            ],
            'errors' => $continueOnError ? $errors : [],
        ]);
    }

    private function readCsvFile(UploadedFile $file): array
    {
        $rows = [];
        $handle = fopen($file->getRealPath(), 'r');

        if (! $handle) {
            return $rows;
        }

        while (($data = fgetcsv($handle)) !== false) {
            $rows[] = $data;
        }

        fclose($handle);

        return $rows;
    }

    /**
     * @return array<int, string>
     */
    private function bulkDeleteProtectedEmails(): array
    {
        return [
            'superadmin@voting.local',
            'electionadmin@voting.local',
            'voter@voting.local',
        ];
    }

    private function applyProtectedVoterExclusion(Builder $query): void
    {
        $protectedEmails = array_map(static fn (string $email): string => Str::lower($email), $this->bulkDeleteProtectedEmails());
        if ($protectedEmails === []) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($protectedEmails), '?'));
        $query->where(function (Builder $builder) use ($protectedEmails, $placeholders): void {
            $builder
                ->whereNull('email')
                ->orWhereRaw("LOWER(email) NOT IN ({$placeholders})", $protectedEmails);
        });
    }

    private function isProtectedAttendanceVoter(User $voter): bool
    {
        if (! $voter->isVoter()) {
            return false;
        }

        $email = is_string($voter->email) ? trim($voter->email) : '';
        if ($email === '') {
            return false;
        }

        $protectedEmails = array_map(static fn (string $item): string => Str::lower($item), $this->bulkDeleteProtectedEmails());

        return in_array(Str::lower($email), $protectedEmails, true);
    }

    private function parseAttendanceStatus(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $normalized = strtolower(trim($value));

        return match ($normalized) {
            'present', 'p', '1', 'yes', 'true' => AttendanceStatus::PRESENT->value,
            'absent', 'a', '0', 'no', 'false' => AttendanceStatus::ABSENT->value,
            default => null,
        };
    }

    private function applyAttendanceStatusFilter(Builder $query, ?int $electionId, string $status): void
    {
        if ($electionId === null) {
            $query->where('attendance_status', $status);

            return;
        }

        if ($status === AttendanceStatus::PRESENT->value) {
            $query->whereExists(function ($builder) use ($electionId): void {
                $builder->select(DB::raw(1))
                    ->from('attendances')
                    ->whereColumn('attendances.user_id', 'users.id')
                    ->where('attendances.election_id', $electionId)
                    ->where('attendances.status', AttendanceStatus::PRESENT->value);
            });

            return;
        }

        $query->whereNotExists(function ($builder) use ($electionId): void {
            $builder->select(DB::raw(1))
                ->from('attendances')
                ->whereColumn('attendances.user_id', 'users.id')
                ->where('attendances.election_id', $electionId)
                ->where('attendances.status', AttendanceStatus::PRESENT->value);
        });
    }

    /**
     * @return array<int, bool>
     */
    private function alreadyVotedByUserId(EloquentCollection $voters, ?int $electionId): array
    {
        if ($voters->isEmpty()) {
            return [];
        }

        if ($electionId === null) {
            return $voters->mapWithKeys(fn (User $voter): array => [
                $voter->id => (bool) $voter->already_voted,
            ])->all();
        }

        $hashesByUserId = $voters->mapWithKeys(fn (User $voter): array => [
            $voter->id => Vote::voterHash((int) $voter->id, $electionId),
        ]);

        $voteHashes = Vote::query()
            ->where('election_id', $electionId)
            ->whereIn('voter_hash', $hashesByUserId->values()->all())
            ->select('voter_hash')
            ->distinct()
            ->pluck('voter_hash')
            ->flip();

        $alreadyVotedByUserId = [];
        foreach ($voters as $voter) {
            $hash = $hashesByUserId[$voter->id];
            $alreadyVotedByUserId[$voter->id] = $voteHashes->has($hash);
        }

        return $alreadyVotedByUserId;
    }

    private function toAttendanceRow(
        User $voter,
        ?int $electionId,
        ?string $electionTitle,
        string $source,
        ?string $checkedInAtOverride = null,
        ?Attendance $attendance = null,
        ?bool $alreadyVotedOverride = null
    ): array {
        if ($attendance && in_array($attendance->status, ['present', 'absent'], true)) {
            $status = $attendance->status;
        } elseif ($electionId !== null) {
            $status = AttendanceStatus::ABSENT->value;
        } else {
            $status = in_array($voter->attendance_status, ['present', 'absent'], true)
                ? $voter->attendance_status
                : AttendanceStatus::ABSENT->value;
        }

        $checkedInAt = $status === AttendanceStatus::PRESENT->value
            ? ($checkedInAtOverride ?? optional($attendance?->checked_in_at)->toIso8601String() ?? optional($voter->updated_at)->toIso8601String())
            : null;
        $alreadyVoted = $alreadyVotedOverride ?? (bool) $voter->already_voted;

        return [
            'id' => $voter->id,
            'election_id' => $electionId ?? 0,
            'user_id' => $voter->id,
            'status' => $status,
            'checked_in_at' => $checkedInAt,
            'source' => $attendance?->source ?? $source,
            'election' => $electionId !== null ? [
                'id' => $electionId,
                'title' => $electionTitle,
            ] : null,
            'user' => [
                'id' => $voter->id,
                'name' => $voter->name,
                'branch' => $voter->branch,
                'voter_id' => $voter->voter_id,
                'attendance_status' => $status,
                'already_voted' => $alreadyVoted,
            ],
            'created_at' => optional($attendance?->created_at ?? $voter->created_at)->toIso8601String(),
            'updated_at' => optional($attendance?->updated_at ?? $voter->updated_at)->toIso8601String(),
        ];
    }
}
