<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'branch' => $this->branch,
            'email' => $this->email,
            'voter_id' => $this->voter_id,
            'voter_key' => $this->voter_key,
            'attendance_id' => $this->attendance_id !== null ? (int) $this->attendance_id : null,
            'role' => $this->role,
            'is_active' => (bool) $this->is_active,
            'attendance_status' => in_array($this->attendance_status, ['present', 'absent'], true)
                ? $this->attendance_status
                : 'absent',
            'already_voted' => (bool) $this->already_voted,
            'has_voted' => $this->when(isset($this->has_voted), fn () => (bool) $this->has_voted),
            'voted_at' => $this->when(isset($this->voted_at), fn () => $this->voted_at),
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}
