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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
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
            'voter_id' => ['nullable', 'string', 'max:100', 'required_without:attendance_id'],
            'attendance_id' => ['nullable', 'integer', 'exists:attendances,id'],
            'status' => ['required', 'in:present,absent'],
            'checked_in_at' => ['nullable', 'date'],
        ]);

        $electionId = (int) $data['election_id'];
        $attendanceId = isset($data['attendance_id']) ? (int) $data['attendance_id'] : null;
        $voter = null;

        if ($attendanceId !== null) {
            $attendanceRecord = Attendance::query()
                ->select(['id', 'user_id'])
                ->whereKey($attendanceId)
                ->where('election_id', $electionId)
                ->first();

            if (! $attendanceRecord) {
                return response()->json([
                    'message' => 'Attendance ID was not found for the selected election.',
                ], 422);
            }

            $voter = User::query()
                ->where('role', UserRole::VOTER->value)
                ->whereKey((int) $attendanceRecord->user_id)
                ->first();
        } else {
            $voterId = trim((string) ($data['voter_id'] ?? ''));
            $voter = User::query()
                ->where('role', UserRole::VOTER->value)
                ->where('voter_id', $voterId)
                ->first();
        }

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
        if (function_exists('set_time_limit')) {
            @set_time_limit(0);
        }
        if (function_exists('ignore_user_abort')) {
            @ignore_user_abort(true);
        }

        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
            'confirmation' => ['required', 'string', 'max:50'],
            'task_id' => ['nullable', 'string', 'max:120'],
        ]);
        $taskId = isset($data['task_id']) ? trim((string) $data['task_id']) : '';
        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'delete',
                'status' => 'deleting',
                'percent' => 5,
                'message' => 'Preparing attendance deletion...',
                'processed' => 0,
                'total' => 0,
            ]);
        }

        if (strtoupper(trim((string) $data['confirmation'])) !== 'DELETE ALL') {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'delete',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => 'Confirmation text must be exactly "DELETE ALL".',
                    'processed' => 0,
                    'total' => 0,
                ]);
            }

            return response()->json([
                'message' => 'Confirmation text must be exactly "DELETE ALL".',
            ], 422);
        }

        $electionId = (int) $data['election_id'];
        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'delete',
                'status' => 'deleting',
                'percent' => 15,
                'message' => 'Loading protected accounts...',
                'processed' => 0,
                'total' => 0,
            ]);
        }

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
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'delete',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => 'No protected voter account was found. Bulk delete was cancelled.',
                    'processed' => 0,
                    'total' => 0,
                ]);
            }

            return response()->json([
                'message' => 'No protected voter account was found. Bulk delete was cancelled.',
            ], 422);
        }

        [$deletedCount, $deletedUserCount, $affectedUserCount] = DB::transaction(function () use ($electionId, $protectedVoterIds, $taskId): array {
            $affectedUserIds = Attendance::query()
                ->where('election_id', $electionId)
                ->select('user_id')
                ->distinct()
                ->pluck('user_id')
                ->map(fn ($userId): int => (int) $userId)
                ->all();

            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'delete',
                    'status' => 'deleting',
                    'percent' => 35,
                    'message' => 'Deleting attendance records...',
                    'processed' => 0,
                    'total' => count($affectedUserIds),
                ]);
            }

            $deletedCount = Attendance::query()
                ->where('election_id', $electionId)
                ->delete();

            if ($affectedUserIds !== []) {
                if ($taskId !== '') {
                    $this->setAttendanceTaskProgress($taskId, [
                        'action' => 'delete',
                        'status' => 'deleting',
                        'percent' => 55,
                        'message' => 'Updating voter attendance status...',
                        'processed' => 0,
                        'total' => count($affectedUserIds),
                    ]);
                }

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

            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'delete',
                    'status' => 'deleting',
                    'percent' => 80,
                    'message' => 'Deleting voter accounts...',
                    'processed' => 0,
                    'total' => $deletedUserCount,
                ]);
            }

            if ($deletedUserCount > 0) {
                $deleteUserQuery->delete();
            }

            return [$deletedCount, $deletedUserCount, count($affectedUserIds)];
        });

        if ($deletedCount === 0 && $deletedUserCount === 0) {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'delete',
                    'status' => 'completed',
                    'percent' => 100,
                    'message' => 'No attendance records or voter accounts found to delete.',
                    'processed' => 0,
                    'total' => 0,
                    'meta' => [
                        'deleted' => 0,
                        'deleted_users' => 0,
                        'affected_voters' => 0,
                    ],
                ]);
            }

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

        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'delete',
                'status' => 'completed',
                'percent' => 100,
                'message' => 'Attendance deletion complete.',
                'processed' => $deletedUserCount,
                'total' => $deletedUserCount,
                'meta' => [
                    'deleted' => $deletedCount,
                    'deleted_users' => $deletedUserCount,
                    'affected_voters' => $affectedUserCount,
                ],
            ]);
        }

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

    public function taskProgress(string $taskId): JsonResponse
    {
        $normalizedTaskId = trim($taskId);
        if ($normalizedTaskId === '') {
            return response()->json([
                'message' => 'Task ID is required.',
            ], 422);
        }

        $snapshot = Cache::get($this->attendanceTaskProgressCacheKey($normalizedTaskId));
        if (! is_array($snapshot)) {
            return response()->json([
                'message' => 'Attendance task progress not found.',
            ], 404);
        }

        return response()->json($snapshot);
    }

    public function import(Request $request): JsonResponse
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(0);
        }
        if (function_exists('ignore_user_abort')) {
            @ignore_user_abort(true);
        }
        @ini_set('upload_max_filesize', '0');
        @ini_set('post_max_size', '0');

        $data = $request->validate([
            'election_id' => ['nullable', 'integer', 'exists:elections,id'],
            'file' => ['required', 'file', 'mimes:csv,txt'],
            'continue_on_error' => ['nullable', 'boolean'],
            'task_id' => ['nullable', 'string', 'max:120'],
        ]);
        $taskId = isset($data['task_id']) ? trim((string) $data['task_id']) : '';
        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'import',
                'status' => 'processing',
                'percent' => 5,
                'message' => 'Reading attendance file...',
                'processed' => 0,
                'total' => 0,
            ]);
        }

        $electionId = isset($data['election_id']) ? (int) $data['election_id'] : null;
        $continueOnError = $request->boolean('continue_on_error', true);

        /** @var UploadedFile $file */
        $file = $request->file('file');
        $rows = $this->readCsvFile($file);

        if (count($rows) < 2) {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'import',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => 'The CSV file must include a header row and at least one attendance row.',
                    'processed' => 0,
                    'total' => 0,
                ]);
            }

            return response()->json([
                'message' => 'The CSV file must include a header row and at least one attendance row.',
            ], 422);
        }

        $headers = array_map(
            fn ($header): string => $this->normalizeCsvHeader((string) $header),
            $rows[0]
        );

        if (! in_array('name', $headers, true)) {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'import',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => 'CSV must contain a NAME column.',
                    'processed' => 0,
                    'total' => max(count($rows) - 1, 0),
                ]);
            }

            return response()->json([
                'message' => 'CSV must contain a NAME column.',
            ], 422);
        }

        $payloads = [];
        $deferredPayloads = [];
        $pendingUsersByNameKey = [];
        $errors = [];
        $totalRows = max(count($rows) - 1, 0);
        $processedRows = 0;
        $rowProgressBatchSize = 25;
        $lastRowProgressPercent = 0;
        $createdUsers = 0;
        $importChunkSize = 500;
        $normalizeNameKey = static function (string $value): string {
            $normalizedName = preg_replace('/\s+/', ' ', trim($value));
            $normalizedName = is_string($normalizedName) ? trim($normalizedName) : trim($value);

            return Str::lower($normalizedName);
        };

        $matchedVotersByName = [];
        $matchedVotersQuery = User::query()
            ->select(['id', 'name'])
            ->where('role', UserRole::VOTER->value)
            ->orderBy('id');
        $this->applyProtectedVoterExclusion($matchedVotersQuery);
        $matchedVotersQuery->chunkById(2000, function (EloquentCollection $matchedVotersChunk) use (&$matchedVotersByName, $normalizeNameKey): void {
            foreach ($matchedVotersChunk as $matchedVoter) {
                $nameKey = $normalizeNameKey((string) $matchedVoter->name);
                if ($nameKey === '' || isset($matchedVotersByName[$nameKey])) {
                    continue;
                }

                $matchedVotersByName[$nameKey] = (int) $matchedVoter->id;
            }
        }, 'id');

        $updateLoopProgress = function () use (
            $taskId,
            &$processedRows,
            $totalRows,
            $rowProgressBatchSize,
            &$lastRowProgressPercent
        ): void {
            if ($taskId === '') {
                return;
            }

            if ($processedRows !== $totalRows && ($processedRows % $rowProgressBatchSize !== 0)) {
                return;
            }

            $safeTotal = max(1, $totalRows);
            $percent = min(85, 10 + (int) floor(($processedRows / $safeTotal) * 75));
            if ($processedRows !== $totalRows && $percent <= $lastRowProgressPercent) {
                return;
            }

            $lastRowProgressPercent = $percent;
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'import',
                'status' => 'processing',
                'percent' => $percent,
                'message' => "Validating attendance rows... {$processedRows}/{$totalRows}",
                'processed' => $processedRows,
                'total' => $totalRows,
            ]);
        };

        foreach ($rows as $index => $rowValues) {
            if ($index === 0) {
                continue;
            }

            $processedRows++;
            $line = $index + 1;
            $row = [];

            foreach ($headers as $position => $header) {
                $rawValue = isset($rowValues[$position]) ? (string) $rowValues[$position] : '';
                $normalizedValue = $this->normalizeCsvValue($rawValue);
                $row[$header] = $normalizedValue !== '' ? $normalizedValue : null;
            }

            $isEmptyRow = true;
            foreach ($row as $value) {
                if ($value !== null && $value !== '') {
                    $isEmptyRow = false;

                    break;
                }
            }
            if ($isEmptyRow) {
                $updateLoopProgress();
                continue;
            }

            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                $errors[] = [
                    'line' => $line,
                    'message' => 'NAME is required.',
                ];

                $updateLoopProgress();
                continue;
            }

            $normalizedName = preg_replace('/\s+/', ' ', $name);
            $normalizedName = is_string($normalizedName) ? trim($normalizedName) : $name;
            $normalizedNameKey = $normalizeNameKey($normalizedName);
            $rowStatus = $this->parseAttendanceStatus(
                isset($row['attendance_status'])
                    ? (string) $row['attendance_status']
                    : (isset($row['status']) ? (string) $row['status'] : null)
            ) ?? AttendanceStatus::ABSENT->value;
            $matchedVoterId = $normalizedNameKey !== '' ? ($matchedVotersByName[$normalizedNameKey] ?? null) : null;

            if ($matchedVoterId === null) {
                $branch = isset($row['branch']) ? trim((string) $row['branch']) : '';
                if (! isset($pendingUsersByNameKey[$normalizedNameKey])) {
                    $pendingUsersByNameKey[$normalizedNameKey] = [
                        'line' => $line,
                        'name' => $normalizedName,
                        'branch' => $branch !== '' ? $branch : null,
                    ];
                }

                $deferredPayloads[] = [
                    'line' => $line,
                    'name_key' => $normalizedNameKey,
                    'status' => $rowStatus,
                ];

                $updateLoopProgress();
                continue;
            }

            $payloads[] = [
                'user_id' => $matchedVoterId,
                'status' => $rowStatus,
            ];

            $updateLoopProgress();
        }

        if ($pendingUsersByNameKey !== []) {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'import',
                    'status' => 'processing',
                    'percent' => 88,
                    'message' => 'Creating missing voters...',
                    'processed' => $processedRows,
                    'total' => $totalRows,
                ]);
            }

            $defaultPasswordHash = Hash::make('Password@123');
            $createdNameKeys = [];
            $timestamp = now();

            foreach (array_chunk(array_keys($pendingUsersByNameKey), $importChunkSize) as $chunkNameKeys) {
                $chunkRows = [];
                foreach ($chunkNameKeys as $chunkNameKey) {
                    $pendingUser = $pendingUsersByNameKey[$chunkNameKey];
                    $chunkRows[] = [
                        'name' => (string) $pendingUser['name'],
                        'branch' => $pendingUser['branch'],
                        'email' => null,
                        'voter_id' => null,
                        'voter_key' => null,
                        'password' => $defaultPasswordHash,
                        'role' => UserRole::VOTER->value,
                        'is_active' => true,
                        'attendance_status' => AttendanceStatus::ABSENT->value,
                        'already_voted' => false,
                        'created_at' => $timestamp,
                        'updated_at' => $timestamp,
                    ];
                }

                try {
                    User::query()->insert($chunkRows);
                    $createdUsers += count($chunkRows);
                    foreach ($chunkNameKeys as $chunkNameKey) {
                        $createdNameKeys[$chunkNameKey] = true;
                    }
                } catch (\Throwable) {
                    foreach ($chunkNameKeys as $chunkNameKey) {
                        $pendingUser = $pendingUsersByNameKey[$chunkNameKey];
                        try {
                            User::query()->insert([[
                                'name' => (string) $pendingUser['name'],
                                'branch' => $pendingUser['branch'],
                                'email' => null,
                                'voter_id' => null,
                                'voter_key' => null,
                                'password' => $defaultPasswordHash,
                                'role' => UserRole::VOTER->value,
                                'is_active' => true,
                                'attendance_status' => AttendanceStatus::ABSENT->value,
                                'already_voted' => false,
                                'created_at' => $timestamp,
                                'updated_at' => $timestamp,
                            ]]);
                            $createdUsers++;
                            $createdNameKeys[$chunkNameKey] = true;
                        } catch (\Throwable) {
                            // Resolution below will mark all rows using this NAME as skipped.
                        }
                    }
                }
            }

            if ($createdNameKeys !== []) {
                $createdNames = [];
                foreach (array_keys($createdNameKeys) as $createdNameKey) {
                    $createdNames[] = (string) $pendingUsersByNameKey[$createdNameKey]['name'];
                }
                $createdNames = array_values(array_unique($createdNames));
                $createdNameKeyLookup = array_fill_keys(array_keys($createdNameKeys), true);

                foreach (array_chunk($createdNames, $importChunkSize) as $createdNameChunk) {
                    $createdUsersQuery = User::query()
                        ->select(['id', 'name'])
                        ->where('role', UserRole::VOTER->value)
                        ->whereIn('name', $createdNameChunk)
                        ->orderBy('id');
                    $this->applyProtectedVoterExclusion($createdUsersQuery);

                    foreach ($createdUsersQuery->get() as $createdVoter) {
                        $createdNameKey = $normalizeNameKey((string) $createdVoter->name);
                        if (! isset($createdNameKeyLookup[$createdNameKey]) || isset($matchedVotersByName[$createdNameKey])) {
                            continue;
                        }

                        $matchedVotersByName[$createdNameKey] = (int) $createdVoter->id;
                    }
                }
            }

            foreach ($deferredPayloads as $deferredPayload) {
                $nameKey = (string) $deferredPayload['name_key'];
                $matchedVoterId = $matchedVotersByName[$nameKey] ?? null;
                if (! is_int($matchedVoterId)) {
                    $errors[] = [
                        'line' => (int) $deferredPayload['line'],
                        'message' => 'Unable to create attendance user from NAME. Check CSV text encoding (UTF-8 recommended).',
                    ];

                    continue;
                }

                $payloads[] = [
                    'user_id' => $matchedVoterId,
                    'status' => (string) ($deferredPayload['status'] ?? AttendanceStatus::ABSENT->value),
                ];
            }
        }

        $skipped = count($errors);

        if (count($errors) > 0 && ! $continueOnError) {
            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'import',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => 'Attendance import failed due to CSV validation errors.',
                    'processed' => $processedRows,
                    'total' => $totalRows,
                ]);
            }

            return response()->json([
                'message' => 'Attendance import failed due to CSV validation errors.',
                'errors' => $errors,
            ], 422);
        }

        if (count($payloads) === 0) {
            $firstError = $errors[0] ?? null;
            $firstErrorMessage = '';
            if (is_array($firstError) && isset($firstError['message'])) {
                $linePrefix = isset($firstError['line']) ? "Line {$firstError['line']}: " : '';
                $firstErrorMessage = $linePrefix.(string) $firstError['message'];
            }
            $noImportMessage = $firstErrorMessage !== ''
                ? "No attendance rows were imported. {$firstErrorMessage}"
                : 'No attendance rows were imported. All rows were skipped.';

            if ($taskId !== '') {
                $this->setAttendanceTaskProgress($taskId, [
                    'action' => 'import',
                    'status' => 'failed',
                    'percent' => 100,
                    'message' => $noImportMessage,
                    'processed' => 0,
                    'total' => $totalRows,
                ]);
            }

            return response()->json([
                'message' => $noImportMessage,
                'meta' => [
                    'created' => 0,
                    'updated' => 0,
                    'total_processed' => 0,
                    'skipped' => $skipped,
                ],
                'errors' => $errors,
            ], 422);
        }

        $statusByUserId = [];
        foreach ($payloads as $payload) {
            $userId = (int) ($payload['user_id'] ?? 0);
            if ($userId <= 0) {
                continue;
            }

            $status = (string) ($payload['status'] ?? AttendanceStatus::ABSENT->value);
            if (! in_array($status, [AttendanceStatus::PRESENT->value, AttendanceStatus::ABSENT->value], true)) {
                $status = AttendanceStatus::ABSENT->value;
            }

            $statusByUserId[$userId] = $status;
        }
        $uniqueUserIds = array_keys($statusByUserId);
        $updated = count($uniqueUserIds);
        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'import',
                'status' => 'processing',
                'percent' => 90,
                'message' => 'Applying attendance updates...',
                'processed' => 0,
                'total' => count($payloads),
            ]);
        }

        $payloadTotal = count($payloads);
        $updateChunkSize = $importChunkSize;
        DB::transaction(function () use ($payloads, $electionId, $statusByUserId, $taskId, $payloadTotal, $updateChunkSize): void {
            $timestamp = now();

            if ($electionId !== null && $payloads !== []) {
                $attendanceRows = array_map(
                    static function (array $payload) use ($electionId, $timestamp): array {
                        $isPresent = (string) ($payload['status'] ?? '') === AttendanceStatus::PRESENT->value;

                        return [
                            'election_id' => $electionId,
                            'user_id' => (int) $payload['user_id'],
                            'status' => (string) $payload['status'],
                            'checked_in_at' => $isPresent ? $timestamp : null,
                            'source' => 'import',
                            'created_at' => $timestamp,
                            'updated_at' => $timestamp,
                        ];
                    },
                    $payloads
                );

                $processedPayloads = 0;
                foreach (array_chunk($attendanceRows, $updateChunkSize) as $chunkRows) {
                    Attendance::query()->upsert(
                        $chunkRows,
                        ['election_id', 'user_id'],
                        ['status', 'checked_in_at', 'source', 'updated_at']
                    );

                    $processedPayloads += count($chunkRows);
                    if ($taskId !== '' && $payloadTotal > 0) {
                        $percent = min(98, 90 + (int) floor(($processedPayloads / $payloadTotal) * 8));
                        $this->setAttendanceTaskProgress($taskId, [
                            'action' => 'import',
                            'status' => 'processing',
                            'percent' => $percent,
                            'message' => 'Applying attendance updates...',
                            'processed' => min($processedPayloads, $payloadTotal),
                            'total' => $payloadTotal,
                        ]);
                    }
                }
            }

            $userIdsByStatus = [
                AttendanceStatus::PRESENT->value => [],
                AttendanceStatus::ABSENT->value => [],
            ];
            foreach ($statusByUserId as $userId => $status) {
                $userIdsByStatus[$status][] = (int) $userId;
            }

            foreach ($userIdsByStatus as $status => $userIds) {
                foreach (array_chunk($userIds, $updateChunkSize) as $chunkUserIds) {
                    User::query()
                        ->whereIn('id', $chunkUserIds)
                        ->update([
                            'attendance_status' => $status,
                        ]);
                }
            }
        });

        AuditLogger::log(
            $request,
            'attendance.import',
            "Attendance import completed for election #".($electionId ?? 0).". Updated: {$updated}, Processed: ".count($payloads).", Skipped: {$skipped}."
        );

        $response = [
            'message' => $continueOnError && $skipped > 0
                ? 'Attendance imported with skipped rows. Review errors for details.'
                : 'Attendance imported successfully.',
            'meta' => [
                'created' => $createdUsers,
                'updated' => $updated,
                'total_processed' => count($payloads),
                'skipped' => $skipped,
            ],
            'errors' => $continueOnError ? $errors : [],
        ];

        if ($taskId !== '') {
            $this->setAttendanceTaskProgress($taskId, [
                'action' => 'import',
                'status' => 'completed',
                'percent' => 100,
                'message' => (string) $response['message'],
                'processed' => (int) $response['meta']['total_processed'],
                'total' => (int) $response['meta']['total_processed'],
                'meta' => $response['meta'],
            ]);
        }

        return response()->json($response);
    }

    private function readCsvFile(UploadedFile $file): array
    {
        $rows = [];
        $handle = fopen($file->getRealPath(), 'r');

        if (! $handle) {
            return $rows;
        }

        $firstLine = fgets($handle);
        if ($firstLine === false) {
            fclose($handle);

            return $rows;
        }

        $firstLine = (string) preg_replace('/^\xEF\xBB\xBF/', '', $firstLine);
        $candidateDelimiters = [',', ';', "\t", '|'];
        $delimiter = ',';
        $highestCount = -1;
        foreach ($candidateDelimiters as $candidateDelimiter) {
            $count = substr_count($firstLine, $candidateDelimiter);
            if ($count > $highestCount) {
                $highestCount = $count;
                $delimiter = $candidateDelimiter;
            }
        }

        rewind($handle);

        while (($data = fgetcsv($handle, 0, $delimiter)) !== false) {
            $rows[] = $data;
        }

        fclose($handle);

        return $rows;
    }

    private function normalizeCsvHeader(string $header): string
    {
        $normalized = $this->normalizeCsvValue((string) preg_replace('/^\xEF\xBB\xBF/', '', $header));
        $normalized = Str::lower($normalized);
        $normalized = preg_replace('/[^a-z0-9]+/', '_', $normalized) ?? '';

        return trim($normalized, '_');
    }

    private function normalizeCsvValue(string $value): string
    {
        $normalized = trim((string) preg_replace('/^\xEF\xBB\xBF/', '', $value));
        if ($normalized === '') {
            return '';
        }

        if (function_exists('mb_detect_encoding') && function_exists('mb_convert_encoding')) {
            $encoding = mb_detect_encoding($normalized, ['UTF-8', 'Windows-1252', 'ISO-8859-1', 'ASCII'], true);
            if (is_string($encoding) && strtoupper($encoding) !== 'UTF-8') {
                $converted = mb_convert_encoding($normalized, 'UTF-8', $encoding);
                if (is_string($converted)) {
                    $normalized = $converted;
                }
            } elseif (!mb_check_encoding($normalized, 'UTF-8')) {
                $converted = mb_convert_encoding($normalized, 'UTF-8', 'Windows-1252');
                if (is_string($converted)) {
                    $normalized = $converted;
                }
            }
        }

        if (function_exists('iconv')) {
            $iconvNormalized = iconv('UTF-8', 'UTF-8//IGNORE', $normalized);
            if (is_string($iconvNormalized)) {
                $normalized = $iconvNormalized;
            }
        }

        return trim($normalized);
    }

    private function attendanceTaskProgressCacheKey(string $taskId): string
    {
        return 'attendance:task_progress:'.$taskId;
    }

    /**
     * @param array{
     *   action?: string,
     *   status?: string,
     *   percent?: int,
     *   message?: string,
     *   processed?: int,
     *   total?: int,
     *   meta?: array<string, mixed>
     * } $payload
     */
    private function setAttendanceTaskProgress(string $taskId, array $payload): void
    {
        $normalizedTaskId = trim($taskId);
        if ($normalizedTaskId === '') {
            return;
        }

        Cache::put(
            $this->attendanceTaskProgressCacheKey($normalizedTaskId),
            [
                'task_id' => $normalizedTaskId,
                'action' => (string) ($payload['action'] ?? 'import'),
                'status' => (string) ($payload['status'] ?? 'processing'),
                'percent' => max(0, min(100, (int) ($payload['percent'] ?? 0))),
                'message' => (string) ($payload['message'] ?? ''),
                'processed' => max(0, (int) ($payload['processed'] ?? 0)),
                'total' => max(0, (int) ($payload['total'] ?? 0)),
                'meta' => is_array($payload['meta'] ?? null) ? $payload['meta'] : null,
                'updated_at' => now()->toIso8601String(),
            ],
            now()->addMinutes(30)
        );
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
            'attendance_id' => $attendance?->id,
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
