import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    createRecording,
    findRecording,
    updateRecordingState,
    updateRecordingWithAudio,
    saveRecordingTranscription,
    deleteRecording,
} from '../repositories/recording.repo';
import {
    uploadRecording as uploadRecordingFile,
    deleteRecording as deleteRecordingFile,
} from '../services/recording-storage.service';
import { realtimeWSService } from '../services/realtime-ws.service';

export const recordingRoutes = new Elysia({ prefix: '/api/recordings' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // Get a recording by its id
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const recording = await findRecording(params.id, auth.user._id);

            if (!recording) {
                set.status = 404;
                return { error: 'Recording not found' };
            }

            return { recording };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new recording placeholder
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const recording = await createRecording(auth.user._id, {
                id: body.id,
                isMultiTrack: body.isMultiTrack,
            });

            // Broadcast recording.started event to collaborators in the same notebook
            if (body.notebookId) {
                console.log('[Recordings] Broadcasting recording.started:', {
                    notebookId: body.notebookId,
                    id: recording.id,
                });
                realtimeWSService.broadcastToNotebookRoom(body.notebookId, {
                    type: 'recording.started',
                    id: recording.id, // Use the UUID, not MongoDB _id
                    notebookId: body.notebookId,
                });
            } else {
                console.log('[Recordings] No notebookId provided, skipping broadcast');
            }

            return { recording };
        },
        {
            body: t.Object({
                id: t.String(),
                isMultiTrack: t.Optional(t.Boolean()),
                notebookId: t.Optional(t.String()), // Parent memo ID for WebSocket broadcasting
            }),
        },
    )

    // Update recording state (for tracking recording/uploading status)
    .put(
        '/:id/state',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const recording = await updateRecordingState(params.id, auth.user._id, body.state);

            if (!recording) {
                set.status = 404;
                return { error: 'Recording not found' };
            }

            return { recording };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                state: t.Union([
                    t.Literal('empty'),
                    t.Literal('recording'),
                    t.Literal('uploading'),
                    t.Literal('complete'),
                    t.Literal('failed'),
                ]),
            }),
        },
    )

    // Upload audio file for a recording
    .post(
        '/:id/upload',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // First check if the recording exists and belongs to the user
            const existingRecording = await findRecording(params.id, auth.user._id);
            if (!existingRecording) {
                set.status = 404;
                return { error: 'Recording not found' };
            }

            // If there's already an audio file, delete it first
            if (existingRecording.audioUrl) {
                await deleteRecordingFile(existingRecording.audioUrl);
            }

            try {
                // Decode base64 audio data
                const audioBuffer = Buffer.from(body.audioData, 'base64');

                // Upload the audio file
                const audioUrl = await uploadRecordingFile(
                    params.id,
                    auth.user._id,
                    audioBuffer,
                    body.mimeType,
                );

                // Update the recording with audio details
                const recording = await updateRecordingWithAudio(params.id, auth.user._id, {
                    audioUrl,
                    duration: body.duration,
                    mimeType: body.mimeType,
                    fileSize: audioBuffer.length,
                });

                if (!recording) {
                    set.status = 500;
                    return { error: 'Failed to update recording' };
                }

                // Broadcast recording.completed event to collaborators in the same notebook
                if (body.notebookId) {
                    console.log('[Recordings] Broadcasting recording.completed:', {
                        notebookId: body.notebookId,
                        id: recording.id,
                    });
                    realtimeWSService.broadcastToNotebookRoom(body.notebookId, {
                        type: 'recording.completed',
                        recording,
                        notebookId: body.notebookId,
                    });
                } else {
                    console.log(
                        '[Recordings] No notebookId provided for upload, skipping broadcast',
                    );
                }

                return { recording };
            } catch (error) {
                console.error('[Recordings] Upload failed:', error);
                // Mark as failed
                await updateRecordingState(params.id, auth.user._id, 'failed');

                // Broadcast recording.failed event
                if (body.notebookId) {
                    realtimeWSService.broadcastToNotebookRoom(body.notebookId, {
                        type: 'recording.failed',
                        id: params.id,
                        error: 'Failed to upload audio',
                        notebookId: body.notebookId,
                    });
                }

                set.status = 500;
                return { error: 'Failed to upload audio' };
            }
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                audioData: t.String(), // Base64 encoded audio
                duration: t.Number(),
                mimeType: t.String(),
                notebookId: t.Optional(t.String()), // Parent memo ID for WebSocket broadcasting
            }),
        },
    )

    // Save transcription for a recording
    .put(
        '/:id/transcription',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const recording = await saveRecordingTranscription(
                params.id,
                auth.user._id,
                body.transcription,
                body.segments,
            );

            if (!recording) {
                set.status = 404;
                return { error: 'Recording not found' };
            }

            // Broadcast recording.completed event to collaborators in the same notebook
            if (body.notebookId) {
                console.log('[Recordings] Broadcasting recording.completed (transcription):', {
                    notebookId: body.notebookId,
                    id: recording.id,
                });
                realtimeWSService.broadcastToNotebookRoom(body.notebookId, {
                    type: 'recording.completed',
                    recording,
                    notebookId: body.notebookId,
                });
            }

            return { recording };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                transcription: t.String(),
                segments: t.Optional(
                    t.Array(
                        t.Object({
                            text: t.String(),
                            start: t.Number(),
                            end: t.Number(),
                            confidence: t.Optional(t.Number()),
                        }),
                    ),
                ),
                notebookId: t.Optional(t.String()), // Parent memo ID for WebSocket broadcasting
            }),
        },
    )

    // Delete a recording
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Get the recording to retrieve the audioUrl
            const recording = await deleteRecording(params.id, auth.user._id);

            if (!recording) {
                set.status = 404;
                return { error: 'Recording not found' };
            }

            // Delete the audio file from storage
            if (recording.audioUrl) {
                await deleteRecordingFile(recording.audioUrl);
            }

            return { message: 'Recording deleted' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
