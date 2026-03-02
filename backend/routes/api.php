<?php

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CandidateController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ElectionController;
use App\Http\Controllers\Api\PositionController;
use App\Http\Controllers\Api\ResultController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VoteController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/voter-access/preview', [AuthController::class, 'previewVoterAccess'])->middleware('throttle:login');
Route::post('/attendance-access/check-in', [AuthController::class, 'attendanceAccessCheckIn'])->middleware('throttle:login');
Route::get('/preview/elections/{election}', [ElectionController::class, 'preview']);

Route::middleware(['auth:sanctum', 'active'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);

    Route::get('/elections', [ElectionController::class, 'index']);
    Route::get('/elections/{election}', [ElectionController::class, 'show']);
    Route::get('/elections/{election}/results', [ResultController::class, 'show']);
    Route::get('/elections/{election}/results/export', [ResultController::class, 'exportCsv']);

    Route::middleware('role:super_admin,election_admin')->group(function () {
        Route::get('/dashboard/overview', [DashboardController::class, 'overview']);
        Route::post('/elections', [ElectionController::class, 'store']);
        Route::put('/elections/{election}', [ElectionController::class, 'update']);
        Route::delete('/elections/{election}', [ElectionController::class, 'destroy']);
        Route::post('/elections/{election}/positions', [PositionController::class, 'store']);
        Route::patch('/elections/{election}/positions/reorder', [PositionController::class, 'reorder']);
        Route::post('/elections/{election}/candidates', [CandidateController::class, 'store']);
        Route::patch('/elections/{election}/candidates/{candidate}', [CandidateController::class, 'update']);
        Route::delete('/elections/{election}/candidates/{candidate}', [CandidateController::class, 'destroy']);
        Route::get('/attendances', [AttendanceController::class, 'index']);
        Route::post('/attendances', [AttendanceController::class, 'store']);
        Route::delete('/attendances', [AttendanceController::class, 'destroyMany']);
        Route::delete('/attendances/{user}', [AttendanceController::class, 'destroy']);
        Route::post('/attendances/import', [AttendanceController::class, 'import']);
        Route::get('/voters', [UserController::class, 'voters']);
        Route::post('/voters', [UserController::class, 'storeVoter']);
        Route::patch('/voters/{user}', [UserController::class, 'updateVoter']);
        Route::delete('/voters', [UserController::class, 'deleteAllVotersExceptProtected']);
        Route::delete('/voters/{user}', [UserController::class, 'deleteVoter']);
        Route::get('/voters/template', [UserController::class, 'downloadTemplate']);
        Route::post('/voters/import', [UserController::class, 'importVoters']);
        Route::get('/voters/import/progress/{importId}', [UserController::class, 'voterImportProgress']);
        Route::get('/voters/export', [UserController::class, 'exportVoters']);
        Route::get('/voters/logs/export', [UserController::class, 'exportVoterLogs']);
    });

    Route::middleware('role:voter')->group(function () {
        Route::post('/vote', [VoteController::class, 'store']);
    });

    Route::middleware('role:super_admin')->group(function () {
        Route::get('/audit-logs', [AuditLogController::class, 'index']);
        Route::get('/users', [UserController::class, 'indexUsers']);
        Route::post('/users', [UserController::class, 'storeUser']);
        Route::patch('/users/{user}', [UserController::class, 'updateUser']);
        Route::delete('/users/{user}', [UserController::class, 'deleteUser']);
        Route::patch('/voters/{user}/status', [UserController::class, 'updateVoterStatus']);
    });
});
