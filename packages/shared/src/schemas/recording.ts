import { Type, Static } from '@sinclair/typebox';

// Recording state machine
export const RecordingStateSchema = Type.Union([
    Type.Literal('empty'), // Node created, no recording yet
    Type.Literal('recording'), // Currently recording
    Type.Literal('uploading'), // Upload in progress
    Type.Literal('complete'), // Ready to play
    Type.Literal('failed'), // Error state
]);

export type RecordingState = Static<typeof RecordingStateSchema>;

// Transcript segment for word-level timing
export const TranscriptSegmentSchema = Type.Object({
    text: Type.String(),
    start: Type.Number(), // Start time in seconds
    end: Type.Number(), // End time in seconds
    confidence: Type.Optional(Type.Number()), // 0-1 confidence score
});

export type TranscriptSegment = Static<typeof TranscriptSegmentSchema>;

// Main recording schema
export const RecordingSchema = Type.Object({
    _id: Type.String(),
    recordingId: Type.String(), // Unique ID used in TipTap node (nanoid) - DEPRECATED, use documentId
    documentId: Type.Optional(Type.String()), // Links to page.documentId (new system)
    userId: Type.String(),
    audioUrl: Type.Optional(Type.String()), // URL to audio file in storage
    duration: Type.Optional(Type.Number()), // Duration in seconds
    state: RecordingStateSchema,
    transcription: Type.Optional(Type.String()), // Full transcription text
    segments: Type.Optional(Type.Array(TranscriptSegmentSchema)), // Word-level timing
    isMultiTrack: Type.Optional(Type.Boolean()), // True if recorded with mic + system audio (desktop)
    mimeType: Type.Optional(Type.String()), // Audio format (e.g., 'audio/webm', 'audio/mp4')
    fileSize: Type.Optional(Type.Number()), // File size in bytes
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Recording = Static<typeof RecordingSchema>;

// Input for creating a new recording placeholder
export const CreateRecordingSchema = Type.Object({
    recordingId: Type.Optional(Type.String()), // Client-generated unique ID - DEPRECATED
    documentId: Type.Optional(Type.String()), // Links to page.documentId (new system)
    isMultiTrack: Type.Optional(Type.Boolean()),
});

export type CreateRecordingInput = Static<typeof CreateRecordingSchema>;

// Input for uploading audio to an existing recording
export const UploadRecordingSchema = Type.Object({
    duration: Type.Number(),
    mimeType: Type.String(),
    fileSize: Type.Number(),
});

export type UploadRecordingInput = Static<typeof UploadRecordingSchema>;

// Input for saving transcription
export const SaveTranscriptionSchema = Type.Object({
    transcription: Type.String(),
    segments: Type.Optional(Type.Array(TranscriptSegmentSchema)),
});

export type SaveTranscriptionInput = Static<typeof SaveTranscriptionSchema>;
