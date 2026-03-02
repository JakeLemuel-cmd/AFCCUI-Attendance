<?php

namespace App\Http\Controllers\Api;

use App\Enums\AttendanceStatus;
use App\Enums\ElectionStatus;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\Attendance;
use App\Models\Election;
use App\Models\User;
use App\Models\Vote;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

class AuthController extends Controller
{
    public function attendanceAccessCheckIn(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
            'voter_id' => ['required', 'string', 'max:100'],
            'voter_key' => ['required', 'string', 'max:255'],
        ]);

        $voter = User::query()
            ->where('role', UserRole::VOTER->value)
            ->where('voter_id', trim((string) $data['voter_id']))
            ->where('voter_key', (string) $data['voter_key'])
            ->first();

        if (! $voter) {
            throw ValidationException::withMessages([
                'voter_id' => ['The provided voter credentials are incorrect.'],
            ]);
        }

        /** @var Election $election */
        $election = Election::query()
            ->select(['id', 'title', 'status', 'start_datetime', 'end_datetime'])
            ->findOrFail((int) $data['election_id']);

        $attendanceForElection = Attendance::query()
            ->where('election_id', $election->id)
            ->where('user_id', $voter->id)
            ->first();
        $statusForElection = $attendanceForElection?->status ?? AttendanceStatus::ABSENT->value;
        $alreadyPresentForElection = $statusForElection === AttendanceStatus::PRESENT->value;

        if (! $voter->is_active) {
            return response()->json([
                'message' => 'Voter account is inactive.',
                'data' => $this->attendanceAccessPayload($voter, $election, $alreadyPresentForElection, false, null, $statusForElection),
            ], 403);
        }

        if ($election->status !== ElectionStatus::OPEN->value || $election->hasEnded()) {
            return response()->json([
                'message' => 'Attendance access is available only while election is open.',
                'data' => $this->attendanceAccessPayload($voter, $election, $alreadyPresentForElection, false, null, $statusForElection),
            ], 403);
        }

        [$alreadyPresent, $markedAt] = DB::transaction(function () use ($voter, $election): array {
            $lockedVoter = User::query()
                ->whereKey($voter->id)
                ->lockForUpdate()
                ->firstOrFail();

            $attendance = Attendance::query()
                ->where('election_id', $election->id)
                ->where('user_id', $lockedVoter->id)
                ->lockForUpdate()
                ->first();

            if ($attendance && $attendance->status === AttendanceStatus::PRESENT->value) {
                return [
                    true,
                    optional($attendance->checked_in_at ?? $attendance->updated_at)->toIso8601String(),
                ];
            }

            $checkedInAt = now();

            if ($attendance) {
                $attendance->forceFill([
                    'status' => AttendanceStatus::PRESENT->value,
                    'checked_in_at' => $checkedInAt,
                    'source' => 'scanner',
                ])->save();
            } else {
                Attendance::query()->create([
                    'election_id' => $election->id,
                    'user_id' => $lockedVoter->id,
                    'status' => AttendanceStatus::PRESENT->value,
                    'checked_in_at' => $checkedInAt,
                    'source' => 'scanner',
                ]);
            }

            $lockedVoter->forceFill([
                'attendance_status' => AttendanceStatus::PRESENT->value,
            ])->save();

            return [false, $checkedInAt->toIso8601String()];
        });

        if ($alreadyPresent) {
            return response()->json([
                'message' => "{$voter->name} is already marked as present.",
                'data' => $this->attendanceAccessPayload(
                    $voter,
                    $election,
                    true,
                    false,
                    $markedAt,
                    AttendanceStatus::PRESENT->value
                ),
            ]);
        }

        AuditLogger::log(
            $request,
            'attendance.access_checkin',
            "Attendance access marked voter #{$voter->id} present in election #{$election->id}."
        );

        return response()->json([
            'message' => "{$voter->name} is now marked as present in attendance.",
            'data' => $this->attendanceAccessPayload(
                $voter->fresh(),
                $election,
                false,
                true,
                $markedAt,
                AttendanceStatus::PRESENT->value
            ),
        ]);
    }

    public function previewVoterAccess(Request $request): JsonResponse
    {
        $data = $request->validate([
            'election_id' => ['required', 'integer', 'exists:elections,id'],
            'voter_id' => ['required', 'string', 'max:100'],
            'voter_key' => ['required', 'string', 'max:255'],
        ]);

        $voter = User::query()
            ->where('role', UserRole::VOTER->value)
            ->where('voter_id', trim((string) $data['voter_id']))
            ->where('voter_key', (string) $data['voter_key'])
            ->first();

        if (! $voter) {
            throw ValidationException::withMessages([
                'voter_id' => ['The provided voter credentials are incorrect.'],
            ]);
        }

        /** @var Election $election */
        $election = Election::query()
            ->select(['id', 'title', 'status', 'start_datetime', 'end_datetime'])
            ->findOrFail((int) $data['election_id']);

        $voterHash = Vote::voterHash((int) $voter->id, (int) $election->id);
        $votedAt = Vote::query()
            ->where('election_id', $election->id)
            ->where('voter_hash', $voterHash)
            ->max('created_at');
        $hasVoted = $votedAt !== null;

        $canProceed = true;
        $reason = null;

        if (! $voter->is_active) {
            $canProceed = false;
            $reason = 'Voter account is inactive.';
        } elseif ($hasVoted) {
            $canProceed = false;
            $reason = 'This voter has already cast their vote.';
        } elseif ($election->status !== ElectionStatus::OPEN->value) {
            $canProceed = false;
            $reason = 'Election is not currently open for voting.';
        } elseif ($election->hasEnded()) {
            $canProceed = false;
            $reason = 'Voting window has ended.';
        } elseif (! $this->isVoterPresentForElection((int) $voter->id, (int) $election->id)) {
            $canProceed = false;
            $reason = "{$voter->name} is not marked present for this election. Attendance first to vote.";
        }

        return response()->json([
            'data' => [
                'voter' => [
                    'name' => $voter->name,
                    'branch' => $voter->branch,
                    'voter_id' => $voter->voter_id,
                    'is_active' => (bool) $voter->is_active,
                    'has_voted' => $hasVoted,
                    'voted_at' => $votedAt,
                ],
                'election' => [
                    'id' => $election->id,
                    'title' => $election->title,
                    'status' => $election->status,
                    'start_datetime' => $election->start_datetime,
                    'end_datetime' => $election->end_datetime,
                ],
                'can_proceed' => $canProceed,
                'reason' => $reason,
            ],
        ]);
    }

    public function login(LoginRequest $request): JsonResponse
    {
        $loginType = (string) $request->input('login_type', 'email');
        $remember = (bool) $request->boolean('remember');

        if ($loginType === 'voter') {
            $voterId = trim((string) $request->input('voter_id'));
            $voterKey = (string) $request->input('voter_key');
            $electionId = $request->filled('election_id') ? (int) $request->input('election_id') : null;

            $voter = User::query()
                ->where('role', UserRole::VOTER->value)
                ->where('voter_id', $voterId)
                ->where('voter_key', $voterKey)
                ->first();

            if (! $voter) {
                AuditLogger::log(
                    $request,
                    'auth.login_failed',
                    'Failed voter login attempt for voter_id: '.$voterId
                );

                throw ValidationException::withMessages([
                    'voter_id' => ['The provided voter credentials are incorrect.'],
                ]);
            }

            if ($electionId && ! $this->isVoterPresentForElection((int) $voter->id, $electionId)) {
                return response()->json([
                    'message' => "{$voter->name} is not marked present for this election. Attendance first to vote.",
                ], 403);
            }

            Auth::login($voter, $remember);
        } else {
            $credentials = $request->safe()->only(['email', 'password']);

            try {
                $authenticated = $this->attemptLoginWithReconnect($credentials, $remember);
            } catch (Throwable $exception) {
                report($exception);

                return response()->json([
                    'message' => 'Authentication service is temporarily unavailable.',
                ], 503);
            }

            if (! $authenticated) {
                AuditLogger::log(
                    $request,
                    'auth.login_failed',
                    'Failed login attempt for email: '.$request->input('email')
                );

                throw ValidationException::withMessages([
                    'email' => ['The provided credentials are incorrect.'],
                ]);
            }
        }

        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        $user = $request->user();

        if (! $user || ! $user->is_active) {
            Auth::guard('web')->logout();
            if ($request->hasSession()) {
                $request->session()->invalidate();
                $request->session()->regenerateToken();
            }

            return response()->json([
                'message' => 'Your account is inactive.',
            ], 403);
        }

        AuditLogger::log(
            $request,
            'auth.login',
            $loginType === 'voter' ? 'User logged in with voter credentials.' : 'User logged in.'
        );

        return response()->json([
            'data' => new UserResource($user),
        ]);
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    private function attemptLoginWithReconnect(array $credentials, bool $remember): bool
    {
        try {
            return Auth::attempt($credentials, $remember);
        } catch (Throwable $exception) {
            $defaultConnection = (string) config('database.default', 'mysql');

            logger()->warning('Initial login DB query failed; retrying once after reconnect.', [
                'connection' => $defaultConnection,
                'host' => config("database.connections.{$defaultConnection}.host"),
                'port' => config("database.connections.{$defaultConnection}.port"),
                'error' => $exception->getMessage(),
            ]);

            DB::purge($defaultConnection);
            DB::reconnect($defaultConnection);

            return Auth::attempt($credentials, $remember);
        }
    }

    public function logout(Request $request): JsonResponse
    {
        if ($request->user()) {
            AuditLogger::log($request, 'auth.logout', 'User logged out.');
        }

        Auth::guard('web')->logout();
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json([
            'message' => 'Logged out successfully.',
        ]);
    }

    public function user(Request $request): JsonResponse
    {
        return response()->json([
            'data' => new UserResource($request->user()),
        ]);
    }

    private function isVoterPresentForElection(int $userId, int $electionId): bool
    {
        return Attendance::query()
            ->where('election_id', $electionId)
            ->where('user_id', $userId)
            ->where('status', AttendanceStatus::PRESENT->value)
            ->exists();
    }

    private function attendanceAccessPayload(
        User $voter,
        Election $election,
        bool $alreadyPresent,
        bool $markedPresent,
        ?string $markedAt,
        ?string $attendanceStatus = null
    ): array {
        $status = in_array($attendanceStatus, ['present', 'absent'], true)
            ? $attendanceStatus
            : AttendanceStatus::ABSENT->value;

        return [
            'voter' => [
                'name' => $voter->name,
                'branch' => $voter->branch,
                'voter_id' => $voter->voter_id,
                'is_active' => (bool) $voter->is_active,
                'attendance_status' => $status,
            ],
            'election' => [
                'id' => $election->id,
                'title' => $election->title,
                'status' => $election->status,
                'start_datetime' => $election->start_datetime,
                'end_datetime' => $election->end_datetime,
            ],
            'already_present' => $alreadyPresent,
            'marked_present' => $markedPresent,
            'marked_at' => $markedAt,
        ];
    }
}
