<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasTable('attendances')) {
            return;
        }

        Schema::create('attendances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')
                ->constrained('elections')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnUpdate()
                ->cascadeOnDelete();
            $table->enum('status', ['present', 'absent'])->default('absent');
            $table->timestamp('checked_in_at')->nullable();
            $table->string('source', 20)->default('manual');
            $table->timestamps();

            $table->unique(['election_id', 'user_id']);
            $table->index(['election_id', 'status']);
        });

        $openElectionIds = DB::table('elections')
            ->where('status', 'open')
            ->pluck('id');

        if ($openElectionIds->isEmpty()) {
            return;
        }

        $presentVoterIds = DB::table('users')
            ->where('role', 'voter')
            ->where('attendance_status', 'present')
            ->pluck('id');

        if ($presentVoterIds->isEmpty()) {
            return;
        }

        $timestamp = now();
        foreach ($openElectionIds as $electionId) {
            foreach ($presentVoterIds->chunk(500) as $chunk) {
                $rows = [];
                foreach ($chunk as $userId) {
                    $rows[] = [
                        'election_id' => (int) $electionId,
                        'user_id' => (int) $userId,
                        'status' => 'present',
                        'checked_in_at' => $timestamp,
                        'source' => 'legacy',
                        'created_at' => $timestamp,
                        'updated_at' => $timestamp,
                    ];
                }

                DB::table('attendances')->insertOrIgnore($rows);
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('attendances');
    }
};
