<?php

namespace App\Http\Requests\Candidate;

use Illuminate\Foundation\Http\FormRequest;

class UpdateCandidateRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'position_id' => ['sometimes', 'integer', 'exists:positions,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'photo_path' => ['nullable', 'string', 'max:2048'],
            'photo' => ['nullable', 'file', 'image', 'mimes:jpg,jpeg,png,webp'],
            'bio' => ['nullable', 'string', 'max:5000'],
        ];
    }
}
