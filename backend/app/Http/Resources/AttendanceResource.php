<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttendanceResource extends JsonResource
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
            'attendance_id' => $this->id,
            'election_id' => $this->election_id,
            'user_id' => $this->user_id,
            'status' => $this->status,
            'checked_in_at' => optional($this->checked_in_at)->toIso8601String(),
            'source' => $this->source,
            'election' => $this->whenLoaded('election', fn () => [
                'id' => $this->election?->id,
                'title' => $this->election?->title,
            ]),
            'user' => $this->whenLoaded('user', fn () => [
                'id' => $this->user?->id,
                'name' => $this->user?->name,
                'branch' => $this->user?->branch,
                'voter_id' => $this->user?->voter_id,
                'attendance_status' => in_array($this->user?->attendance_status, ['present', 'absent'], true)
                    ? $this->user?->attendance_status
                    : 'absent',
                'already_voted' => (bool) $this->user?->already_voted,
            ]),
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}
