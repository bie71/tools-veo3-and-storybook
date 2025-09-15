import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Type } from '@google/genai';
import { GoogleGenAI } from "@google/genai";
import InputGroup from './InputGroup';
import { TrashIcon, LoaderIcon } from './icons';
import { CHARACTER_STYLES } from '../constants';
import { trackEvent } from '../analytics';

interface VideoGeneratorProps {
    apiKey: string;
}

type ContinuityMode = 'none' | 'last_frame' | 'upload';

interface SegmentItem {
    id: string;
    prompt: string;
    duration: number;
    continuity: ContinuityMode;
    imageFile?: File | null;
    imagePreview?: string | null;
    status?: string;
    error?: string | null;
    videoUrl?: string | null;
    thumbDataUrl?: string | null;
}

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RESOLUTIONS = ["480p", "720p", "1080p", "2K"] as const;
const AI_MODES = ['Cinematic', 'Realistic', 'Animated', 'Documentary', 'Vlog', 'Surreal'];
const VIDEO_MODELS = ['veo-3.0-generate-001', 'veo-2.0-generate-001'];


const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = error => reject(error);
    });
};

const VideoGenerator: React.FC<VideoGeneratorProps> = ({ apiKey }) => {
    const [prompt, setPrompt] = useState('');
    const [duration, setDuration] = useState(10);
    const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
    const [resolution, setResolution] = useState<typeof RESOLUTIONS[number]>("1080p");
    const [enableAudio, setEnableAudio] = useState(true);
    const [aiMode, setAiMode] = useState(AI_MODES[0]);
    const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0]); // Default to the latest model
    const [useCustomModel, setUseCustomModel] = useState(false);
    const [customModelId, setCustomModelId] = useState('');
    const [characterStyle, setCharacterStyle] = useState(CHARACTER_STYLES[0]);
    const [segmentedMode, setSegmentedMode] = useState(false);
    const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
    const [isMerging, setIsMerging] = useState(false);
    const [crossfadeSeconds, setCrossfadeSeconds] = useState(0.5);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    // Segmented generation state
    const [segments, setSegments] = useState<SegmentItem[]>([
        { id: crypto.randomUUID(), prompt: '', duration: 8, continuity: 'none', imageFile: null, imagePreview: null }
    ]);
    const playlistVideoRef = useRef<HTMLVideoElement | null>(null);
    const playlistUrls = useMemo(() => segments.map(s => s.videoUrl).filter(Boolean) as string[], [segments]);
    
    const [isLoading, setIsLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 4 * 1024 * 1024) { // 4MB limit
                setError("Image size should not exceed 4MB.");
                return;
            }
            setError(null);
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
        e.target.value = ''; // Allow re-uploading the same file
    };
    
    const removeImage = () => {
        setImageFile(null);
        if (imagePreview) {
            URL.revokeObjectURL(imagePreview);
            setImagePreview(null);
        }
    };

    // Persist segments (structure only) to localStorage
    React.useEffect(() => {
        try {
            const clean = segments.map(s => ({
                id: s.id,
                prompt: s.prompt,
                duration: s.duration,
                continuity: s.continuity,
                thumbDataUrl: s.thumbDataUrl || null,
            }));
            localStorage.setItem('veo_segments', JSON.stringify(clean));
            localStorage.setItem('veo_segmented_mode', JSON.stringify(segmentedMode));
            localStorage.setItem('veo_base_prompt', prompt || '');
        } catch {}
    }, [segments, segmentedMode, prompt]);

    React.useEffect(() => {
        try {
            const saved = localStorage.getItem('veo_segments');
            const savedMode = localStorage.getItem('veo_segmented_mode');
            const savedPrompt = localStorage.getItem('veo_base_prompt');
            if (savedPrompt) setPrompt(savedPrompt);
            if (savedMode) setSegmentedMode(JSON.parse(savedMode));
            if (saved) {
                const arr = JSON.parse(saved) as Array<Partial<SegmentItem>>;
                if (Array.isArray(arr) && arr.length) {
                    setSegments(arr.map((s, idx) => ({
                        id: s.id || crypto.randomUUID(),
                        prompt: s.prompt || '',
                        duration: Math.max(1, Math.min(8, Number(s.duration) || 8)),
                        continuity: (s.continuity as any) || 'none',
                        imageFile: null,
                        imagePreview: null,
                        status: undefined,
                        error: null,
                        videoUrl: null,
                        thumbDataUrl: s.thumbDataUrl || null,
                    })));
                }
            }
        } catch {}
        // run once
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSegmentImageChange = (segmentId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 4 * 1024 * 1024) { // 4MB limit
                setError("Image size should not exceed 4MB.");
                return;
            }
            const preview = URL.createObjectURL(file);
            setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, imageFile: file, imagePreview: preview } : s));
        }
        e.target.value = '';
    };

    const clearSegmentImage = (segmentId: string) => {
        setSegments(prev => prev.map(s => {
            if (s.id !== segmentId) return s;
            if (s.imagePreview) URL.revokeObjectURL(s.imagePreview);
            return { ...s, imageFile: null, imagePreview: null };
        }));
    };

    const addSegment = () => {
        setSegments(prev => [...prev, { id: crypto.randomUUID(), prompt: '', duration: 8, continuity: 'last_frame', imageFile: null, imagePreview: null }]);
    };
    const removeSegment = (id: string) => {
        setSegments(prev => prev.filter(s => s.id !== id));
    };
    const updateSegment = (id: string, field: keyof SegmentItem, value: any) => {
        setSegments(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const extractLastFrameBase64 = useCallback(async (videoUrl: string): Promise<{ imageBytes: string; mimeType: string }> => {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = videoUrl;
            video.crossOrigin = 'anonymous';
            video.muted = true;
            video.addEventListener('loadedmetadata', () => {
                const targetTime = Math.max(0, video.duration - 0.1);
                const onSeeked = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth || 512;
                    canvas.height = video.videoHeight || 512;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Canvas context not available'));
                        return;
                    }
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg');
                    const base64 = dataUrl.split(',')[1];
                    resolve({ imageBytes: base64, mimeType: 'image/jpeg' });
                };
                video.currentTime = targetTime;
                video.addEventListener('seeked', onSeeked, { once: true });
            }, { once: true });
            video.addEventListener('error', () => reject(new Error('Failed to load video for frame extraction')));
        });
    }, []);

    const handleGenerateVideo = async () => {
        try {
            trackEvent('generate_video_start', {
                segmented: segmentedMode,
                model: (useCustomModel && customModelId.trim()) ? 'custom' : videoModel,
                aspect_ratio: aspectRatio,
                resolution,
                enable_audio: enableAudio,
                ai_mode: aiMode,
                character_style: characterStyle,
            });
        } catch {}
        if (!apiKey) {
            setError('Please enter and save your Gemini API Key in the header.');
            return;
        }
        if (segmentedMode) {
            await handleGenerateSegments();
            return;
        }
        if (!prompt) {
            setError('Please enter a prompt.');
            return;
        }
        if (useCustomModel && !customModelId.trim()) {
            setError('Please enter a custom model ID or switch to a preset model.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedVideoUrl(null);
        setStatusMessage('Initializing video generation...');
        
        try {
            const ai = new GoogleGenAI({ apiKey });
            
            let imagePayload;
            if (imageFile) {
                setStatusMessage('Processing reference image...');
                const base64Data = await fileToBase64(imageFile);
                imagePayload = {
                    imageBytes: base64Data,
                    mimeType: imageFile.type,
                };
            }
            
            const promptAdditions = [
                `${aiMode} style`,
                `with ${characterStyle} characters`,
                `aspect ratio ${aspectRatio}`,
                `${duration} seconds long`,
                `${resolution} resolution`,
                enableAudio ? 'with cinematic audio and sound effects' : 'silent',
            ];

            const fullPrompt = `${prompt}. ${promptAdditions.join(', ')}.`;

            setStatusMessage('Sending request to VEO model...');
            const modelId = useCustomModel && customModelId.trim() ? customModelId.trim() : videoModel;
            let operation = await ai.models.generateVideos({
              model: modelId,
              prompt: fullPrompt,
              image: imagePayload,
              config: {
                numberOfVideos: 1
              }
            });
            
            setStatusMessage('Video generation started. This can take a few minutes...');
            let pollCount = 0;
            while (!operation.done) {
              pollCount++;
              setStatusMessage(`Polling for results (Attempt ${pollCount})... Please be patient.`);
              await new Promise(resolve => setTimeout(resolve, 10000));
              operation = await ai.operations.getVideosOperation({operation: operation});
            }
            
            if (operation.error) {
                throw new Error(String(operation.error.message) || 'An error occurred during video processing on the server.');
            }

            if (!operation.response?.generatedVideos?.[0]?.video?.uri) {
                throw new Error('Video generation finished, but no video URL was returned.');
            }

            setStatusMessage('Video generated! Fetching video data...');
            const downloadLink = operation.response.generatedVideos[0].video.uri;
            const videoResponse = await fetch(`${downloadLink}&key=${apiKey}`);
            
            if (!videoResponse.ok) {
                throw new Error(`Failed to download video: ${videoResponse.statusText}`);
            }

            const videoBlob = await videoResponse.blob();
            const videoUrl = URL.createObjectURL(videoBlob);
            setGeneratedVideoUrl(videoUrl);
            setStatusMessage('Done!');
            try { trackEvent('generate_video_success', { duration_sec: duration, segmented: false }); } catch {}

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'An unknown error occurred during video generation.');
            try { trackEvent('generate_video_error', { message: String(err?.message || '').slice(0, 120) }); } catch {}
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateSegments = async () => {
        if (segments.length === 0) {
            setError('Please add at least one segment.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedVideoUrl(null);
        setSegments(prev => prev.map(s => ({ ...s, videoUrl: null, error: null, status: 'Queued...' })));
        try {
            trackEvent('generate_segments_start', {
                count: segments.length,
                aspect_ratio: aspectRatio,
                resolution,
                enable_audio: enableAudio,
                ai_mode: aiMode,
                character_style: characterStyle,
            });
        } catch {}
        try {
            const ai = new GoogleGenAI({ apiKey });
            let previousUrl: string | null = null;
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                setStatusMessage(`Segment ${i + 1}/${segments.length}: preparing...`);
                setSegments(prev => prev.map(s => s.id === seg.id ? { ...s, status: 'Processing...' } : s));

                let imagePayload: { imageBytes: string; mimeType: string } | undefined;
                if (seg.continuity === 'last_frame' && previousUrl) {
                    setStatusMessage(`Extracting last frame from previous segment...`);
                    imagePayload = await extractLastFrameBase64(previousUrl);
                } else if (seg.continuity === 'upload' && seg.imageFile) {
                    setStatusMessage('Processing reference image...');
                    const base64Data = await fileToBase64(seg.imageFile);
                    imagePayload = { imageBytes: base64Data, mimeType: seg.imageFile.type };
                }

                const additions = [
                    `${aiMode} style`,
                    `with ${characterStyle} characters`,
                    `aspect ratio ${aspectRatio}`,
                    `${seg.duration} seconds long`,
                    `${resolution} resolution`,
                    enableAudio ? 'with cinematic audio and sound effects' : 'silent',
                ];
                const fullPrompt = `${seg.prompt || prompt}. ${additions.join(', ')}.`;

                setStatusMessage('Sending request to VEO model...');
                const modelId = useCustomModel && customModelId.trim() ? customModelId.trim() : videoModel;
                let operation = await ai.models.generateVideos({
                    model: modelId,
                    prompt: fullPrompt,
                    image: imagePayload,
                    config: { numberOfVideos: 1 }
                });

                setStatusMessage('Video generation started...');
                let pollCount = 0;
                while (!operation.done) {
                    pollCount++;
                    setSegments(prev => prev.map(s => s.id === seg.id ? { ...s, status: `Polling (${pollCount})...` } : s));
                    await new Promise(r => setTimeout(r, 10000));
                    operation = await ai.operations.getVideosOperation({ operation });
                }
                if (operation.error) throw new Error(String(operation.error.message));
                const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
                if (!uri) throw new Error('Video generation finished, but no URL was returned.');

                setStatusMessage('Fetching generated video segment...');
                const videoResponse = await fetch(`${uri}&key=${apiKey}`);
                if (!videoResponse.ok) throw new Error(`Failed to download segment: ${videoResponse.statusText}`);
                const blob = await videoResponse.blob();
                const url = URL.createObjectURL(blob);
                previousUrl = url;
                // Extract a small thumbnail from first frame
                let thumb: string | null = null;
                try {
                    const frame = await extractLastFrameBase64(url); // reuse extractor (last frame ok for preview)
                    thumb = `data:${frame.mimeType};base64,${frame.imageBytes}`;
                } catch {}
                setSegments(prev => prev.map(s => s.id === seg.id ? { ...s, videoUrl: url, status: 'Done', thumbDataUrl: thumb } : s));
            }
            setStatusMessage('All segments generated! You can Play All or download each.');
            try { trackEvent('generate_segments_complete', { count: segments.length }); } catch {}
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'An error occurred during segmented generation.');
            try { trackEvent('generate_segments_error', { message: String(err?.message || '').slice(0, 120) }); } catch {}
        } finally {
            setIsLoading(false);
        }
    };

    const autoGenerateSegmentPrompts = async (count: number) => {
        if (!apiKey) { setError('Please set your API key.'); return; }
        if (!prompt.trim()) { setError('Please enter a base prompt first.'); return; }
        if (count < 1 || count > 8) { setError('Choose 1 to 8 segments.'); return; }
        setIsLoading(true);
        setStatusMessage('Generating segment prompts...');
        try {
            const ai = new GoogleGenAI({ apiKey });
            const res = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Split this video concept into ${count} consecutive segments (max 8s each). Return JSON with an array 'segments' of objects: {prompt: string, duration: number (1-8)}. Concept: ${prompt}`,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            segments: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        prompt: { type: Type.STRING },
                                        duration: { type: Type.NUMBER },
                                    },
                                    required: ['prompt','duration']
                                }
                            }
                        },
                        required: ['segments']
                    }
                }
            });
            const data = JSON.parse(res.text);
            const newSegs: SegmentItem[] = data.segments.slice(0, count).map((s: any) => ({
                id: crypto.randomUUID(),
                prompt: String(s.prompt || ''),
                duration: Math.max(1, Math.min(8, Math.round(Number(s.duration) || 8))),
                continuity: 'last_frame',
                imageFile: null,
                imagePreview: null,
            }));
            setSegments(newSegs.length ? newSegs : [ { id: crypto.randomUUID(), prompt: '', duration: 8, continuity: 'none', imageFile: null, imagePreview: null } ]);
            setStatusMessage('Segment prompts generated.');
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Failed to generate segment prompts');
        } finally {
            setIsLoading(false);
        }
    };

    const mergeSegmentsToMp4 = async () => {
        const urls = segments.map(s => s.videoUrl).filter(Boolean) as string[];
        if (urls.length < 2) { setError('Need at least two segments to merge.'); return; }
        setIsMerging(true);
        setStatusMessage('Preparing FFmpeg (this may take a while)...');
        try { trackEvent('merge_segments', { method: 'concat', count: urls.length }); } catch {}
        try {
            const mod: any = await import('@ffmpeg/ffmpeg');
            const ffmpeg = mod.createFFmpeg({ log: false });
            await ffmpeg.load();
            // Write segment files
            const listLines: string[] = [];
            for (let i = 0; i < urls.length; i++) {
                const name = `seg${i}.mp4`;
                ffmpeg.FS('writeFile', name, await mod.fetchFile(urls[i]));
                listLines.push(`file ${name}`);
            }
            ffmpeg.FS('writeFile', 'list.txt', new TextEncoder().encode(listLines.join('\n')));
            setStatusMessage('Merging segments...');
            // Try stream copy concat (fast). If it fails in runtime, we can later fall back to re-encode.
            await ffmpeg.run('-f','concat','-safe','0','-i','list.txt','-c','copy','output.mp4');
            const data = ffmpeg.FS('readFile','output.mp4');
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            setMergedVideoUrl(url);
            setStatusMessage('Merged video ready.');
            try { trackEvent('merge_segments_success', { method: 'concat' }); } catch {}
        } catch (e: any) {
            console.error(e);
            setError('Merging failed. The segments may have incompatible codecs. Try using same model/aspect/resolution for all.');
            try { trackEvent('merge_segments_error', { method: 'concat' }); } catch {}
        } finally {
            setIsMerging(false);
        }
    };

    const mergeSegmentsWithCrossfade = async (fadeSeconds = 0.5) => {
        const urls = segments.map(s => s.videoUrl).filter(Boolean) as string[];
        if (urls.length < 2) { setError('Need at least two segments to merge.'); return; }
        setIsMerging(true);
        setStatusMessage('Loading FFmpeg (this may take a while)...');
        try { trackEvent('merge_segments', { method: 'crossfade', count: urls.length, fade_seconds: fadeSeconds }); } catch {}
        try {
            const mod: any = await import('@ffmpeg/ffmpeg');
            const ffmpeg = mod.createFFmpeg({ log: false });
            await ffmpeg.load();

            // Write all segments to FS
            for (let i = 0; i < urls.length; i++) {
                const name = `seg${i}.mp4`;
                ffmpeg.FS('writeFile', name, await mod.fetchFile(urls[i]));
            }

            // Progressive merge pairwise with crossfade
            let currentName = 'seg0.mp4';
            for (let i = 1; i < urls.length; i++) {
                const nextName = `seg${i}.mp4`;
                const outName = `merge_${i}.mp4`;
                const leftDur = Math.max(1, Number(segments[i - 1].duration) || 8);
                const offset = Math.max(0.0, leftDur - fadeSeconds);
                setStatusMessage(`Crossfading segment ${i} → ${i + 1} ...`);
                try {
                    await ffmpeg.run(
                        '-i', currentName,
                        '-i', nextName,
                        '-filter_complex',
                        `[0:v][1:v]xfade=transition=fade:duration=${fadeSeconds}:offset=${offset}[v];` +
                        `[0:a][1:a]acrossfade=d=${fadeSeconds}[a]`,
                        '-map', '[v]', '-map', '[a]',
                        '-pix_fmt','yuv420p',
                        '-movflags','+faststart',
                        outName
                    );
                } catch (_err) {
                    // Fallback: video-only crossfade
                    await ffmpeg.run(
                        '-i', currentName,
                        '-i', nextName,
                        '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${fadeSeconds}:offset=${offset}[v]`,
                        '-map', '[v]',
                        '-pix_fmt','yuv420p',
                        '-movflags','+faststart',
                        outName
                    );
                }
                // Prepare for next iteration
                currentName = outName;
            }

            const data = ffmpeg.FS('readFile', currentName);
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            setMergedVideoUrl(url);
            setStatusMessage('Crossfade merged video ready.');
            try { trackEvent('merge_segments_success', { method: 'crossfade' }); } catch {}
        } catch (e: any) {
            console.error(e);
            setError('Crossfade merge failed. This is CPU-intensive in the browser.');
            try { trackEvent('merge_segments_error', { method: 'crossfade' }); } catch {}
        } finally {
            setIsMerging(false);
        }
    };

    const renderSelect = (label: string, value: string, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, options: readonly string[]) => {
        const isCustom = !options.includes(value);
        const onSel = (e: React.ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value as string;
            if (v === '__custom__') return (onChange as any)({ target: { value: '' } });
            onChange(e);
        };
        return (
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                <select 
                    value={isCustom ? '__custom__' : value}
                    onChange={onSel}
                    className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                    aria-label={label}
                >
                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    <option value="__custom__">Custom…</option>
                </select>
                {isCustom && (
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => (onChange as any)({ target: { value: e.target.value } })}
                        placeholder={`Custom `}
                        className="mt-2 w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                )}
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* INPUTS COLUMN */}
            <div className="flex flex-col space-y-6">
                <InputGroup title="Video Prompt & Settings">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Mode:</span>
                        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden">
                            <button type="button" onClick={() => setSegmentedMode(false)} className={`px-3 py-1 text-sm ${!segmentedMode ? 'bg-indigo-600 text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}>Single</button>
                            <button type="button" onClick={() => setSegmentedMode(true)} className={`px-3 py-1 text-sm ${segmentedMode ? 'bg-indigo-600 text-white' : 'bg-transparent text-gray-700 dark:text-gray-300'}`}>Segmented</button>
                        </div>
                    </div>
                    {/* Video Model at top for visibility */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Video Model</label>
                        <select
                            value={useCustomModel ? '__custom__' : videoModel}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__custom__') {
                                    setUseCustomModel(true);
                                } else {
                                    setUseCustomModel(false);
                                    setVideoModel(v);
                                }
                            }}
                            className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                            aria-label="Video Model"
                        >
                            {VIDEO_MODELS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                            <option value="__custom__">Custom…</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Select Veo model (e.g., veo-3.0). Choose “Custom…” to type another model ID.</p>
                        {useCustomModel && (
                            <input
                                type="text"
                                value={customModelId}
                                onChange={(e) => setCustomModelId(e.target.value)}
                                placeholder="Enter model ID, e.g., veo-3.0-generate-001"
                                className="mt-2 w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                aria-label="Custom Model ID"
                            />
                        )}
                    </div>
                    {!segmentedMode && (
                        <>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
                            <textarea 
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                placeholder="e.g., A neon hologram of a cat driving at top speed"
                                className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y min-h-64"
                                rows={12}
                                aria-label="Video Prompt"
                            />
                        </>
                    )}
                    {segmentedMode && (
                        <div className="mt-4 p-3 rounded-md border border-gray-300 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40">
                            <div className="flex items-center gap-3 mb-3">
                                <label className="text-sm text-gray-700 dark:text-gray-300">Base Prompt</label>
                                <input
                                    type="text"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Overall concept used to generate segment prompts"
                                    className="flex-1 bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                                <label className="text-sm text-gray-700 dark:text-gray-300">Count</label>
                                <input id="seg-count" type="number" min={1} max={8} defaultValue={segments.length} className="w-20 bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const el = document.getElementById('seg-count') as HTMLInputElement | null;
                                        const val = el ? parseInt(el.value || '1', 10) : segments.length;
                                        autoGenerateSegmentPrompts(Math.max(1, Math.min(8, val)));
                                    }}
                                    className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                                >
                                    Generate Segment Prompts
                                </button>
                            </div>
                        </div>
                    )}
                    {segmentedMode && (
                        <div className="mt-4 p-3 rounded-md border border-gray-300 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Segments</h4>
                                <button onClick={addSegment} className="text-sm px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Add Segment</button>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">Chain multiple 8s clips. Segment prompt overrides base prompt for that segment; leave empty to use the Base Prompt.</p>
                            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                                {segments.map((s, idx) => (
                                    <div key={s.id} className="p-3 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Segment {idx + 1}</span>
                                            {segments.length > 1 && (
                                                <button onClick={() => removeSegment(s.id)} className="text-xs text-red-600 hover:text-red-700">Remove</button>
                                            )}
                                        </div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt (optional)</label>
                                        <textarea
                                            value={s.prompt}
                                            onChange={e => updateSegment(s.id, 'prompt', e.target.value)}
                                            placeholder={`Describe segment ${idx + 1} action`}
                                            className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500 mb-2"
                                            rows={2}
                                        />
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Duration (1-8s)</label>
                                                <input type="number" min={1} max={8} value={s.duration} onChange={e => updateSegment(s.id, 'duration', Math.max(1, Math.min(8, parseInt(e.target.value || '1', 10))))} className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Continuity</label>
                                                <select value={s.continuity} onChange={e => updateSegment(s.id, 'continuity', e.target.value as ContinuityMode)} className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2">
                                                    <option value="none">None</option>
                                                    <option value="last_frame">Use last frame</option>
                                                    <option value="upload">Upload reference</option>
                                                </select>
                                            </div>
                                            <div>
                                                {s.continuity === 'upload' ? (
                                                    s.imagePreview ? (
                                                        <div className="flex items-center gap-2">
                                                            <img src={s.imagePreview} className="w-10 h-10 rounded object-cover border border-gray-300 dark:border-gray-600" />
                                                            <button onClick={() => clearSegmentImage(s.id)} className="text-xs text-red-600 hover:text-red-700">Clear</button>
                                                        </div>
                                                    ) : (
                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                                                            Reference Image
                                                            <input type="file" className="mt-1 block w-full text-xs" onChange={e => handleSegmentImageChange(s.id, e as any)} accept="image/png, image/jpeg, image/webp" />
                                                        </label>
                                                    )
                                                ) : (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 pt-5">{s.continuity === 'last_frame' ? 'Will use previous segment last frame' : 'No reference'}</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                        {renderSelect('AI Mode', aiMode, e => setAiMode(e.target.value), AI_MODES)}
                        {renderSelect('Character Style', characterStyle, e => setCharacterStyle(e.target.value), CHARACTER_STYLES)}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration (seconds)</label>
                            <input 
                                type="number" 
                                value={duration}
                                min="1"
                                max="60"
                                onChange={e => setDuration(parseInt(e.target.value, 10))}
                                className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                                aria-label="Video Duration"
                            />
                        </div>
                        {renderSelect('Aspect Ratio', aspectRatio, e => setAspectRatio(e.target.value), ASPECT_RATIOS)}
                        {renderSelect('Resolution', resolution, e => setResolution(e.target.value), RESOLUTIONS as unknown as string[])}
                    </div>
                     <div className="flex items-center">
                        <input
                            id="enable-audio"
                            type="checkbox"
                            checked={enableAudio}
                            onChange={(e) => setEnableAudio(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-400 dark:border-gray-500 bg-gray-200 dark:bg-gray-700 text-indigo-600 focus:ring-indigo-600"
                        />
                        <label htmlFor="enable-audio" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                            Enable Audio
                        </label>
                    </div>
                </InputGroup>

                {!segmentedMode && (
                <InputGroup title="Image Reference (Optional)">
                    {imagePreview ? (
                        <div className="flex items-center space-x-4">
                           <img src={imagePreview} alt="Reference preview" className="w-24 h-24 object-cover rounded-md border border-gray-300 dark:border-gray-600"/>
                           <div className="flex-grow">
                               <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{imageFile?.name}</p>
                               <button onClick={removeImage} className="mt-1 flex items-center text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300">
                                   <TrashIcon/> <span className="ml-1">Remove Image</span>
                               </button>
                           </div>
                        </div>
                    ) : (
                         <div className="flex items-center justify-center w-full">
                            <label htmlFor="file-upload" className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-400 dark:border-gray-600 border-dashed rounded-lg cursor-pointer bg-gray-200/50 dark:bg-gray-800/80 hover:bg-gray-300/50 dark:hover:bg-gray-700/50">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <svg className="w-8 h-8 mb-4 text-gray-500 dark:text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/></svg>
                                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                                    <p className="text-xs text-gray-500">PNG, JPG, WEBP (MAX. 4MB)</p>
                                </div>
                                <input id="file-upload" type="file" className="hidden" onChange={handleImageChange} accept="image/png, image/jpeg, image/webp" />
                            </label>
                        </div> 
                    )}
                </InputGroup>
                )}
                
                <button
                    onClick={handleGenerateVideo}
                    disabled={isLoading}
                    className="w-full flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                >
                    {isLoading ? <><LoaderIcon /> <span className="ml-2">Generating...</span></> : (segmentedMode ? 'Generate Segments' : 'Generate Video')}
                </button>
            </div>
            {/* OUTPUT COLUMN (side-by-side on desktop, stacked on mobile) */}
            <div className="sticky top-[150px] h-fit flex flex-col justify-center items-center bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg p-4 min-h-[400px] backdrop-blur-sm">
                {isLoading ? (
                    <div className="text-center" role="status" aria-live="polite">
                        <LoaderIcon />
                        <p className="text-indigo-600 dark:text-indigo-400 mt-4">{statusMessage}</p>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2">
                           <div className="bg-indigo-600 h-2.5 rounded-full animate-pulse w-3/4 mx-auto"></div>
                        </div>
                    </div>
                ) : error ? (
                    <div className="w-full p-4 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg break-words max-h-48 overflow-auto overflow-x-hidden" role="alert">
                        <p className="font-bold text-center">Error</p>
                        <p className="text-center mt-2 break-words break-all whitespace-pre-wrap w-full max-w-full">{error}</p>
                    </div>
                ) : generatedVideoUrl ? (
                     <div className="w-full">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Generated Video</h3>
                          <a
                            href={generatedVideoUrl}
                            download={`veo-video-${Date.now()}.mp4`}
                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                            onClick={() => { try { trackEvent('video_download', { kind: 'single' }); } catch {} }}
                          >
                            Download MP4
                          </a>
                        </div>
                        <video controls src={generatedVideoUrl} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 shadow-lg" onPlay={() => { try { trackEvent('video_play', { kind: 'single' }); } catch {} }}>
                            Your browser does not support the video tag.
                        </video>
                    </div>
                ) : playlistUrls.length > 0 ? (
                    <div className="w-full">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Generated Segments</h3>
                            <button
                                onClick={() => {
                                    try { trackEvent('segments_play_all', { count: playlistUrls.length }); } catch {}
                                    const v = playlistVideoRef.current;
                                    if (v && playlistUrls.length > 0) {
                                        v.src = playlistUrls[0];
                                        v.play();
                                    }
                                }}
                                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                            >
                                Play All
                            </button>
                        </div>
                        <video
                            ref={playlistVideoRef}
                            controls
                            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 shadow-lg mb-4 transition-opacity duration-300"
                            onPlay={() => { try { trackEvent('video_play', { kind: 'playlist' }); } catch {} }}
                            onEnded={() => {
                                const v = playlistVideoRef.current;
                                if (!v) return;
                                const currentIndex = playlistUrls.indexOf(v.currentSrc);
                                const nextIndex = currentIndex + 1;
                                if (nextIndex < playlistUrls.length) {
                                    v.style.opacity = '0';
                                    setTimeout(() => {
                                        v.src = playlistUrls[nextIndex];
                                        v.oncanplay = () => {
                                            v.style.opacity = '1';
                                            v.play();
                                        };
                                    }, 150);
                                }
                            }}
                        />
                        {segments.length > 1 && (
                            <div className="flex items-center justify-end mb-4">
                                <div className="inline-flex gap-2">
                                    <button
                                        onClick={mergeSegmentsToMp4}
                                        disabled={isMerging}
                                        className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
                                    >
                                        {isMerging ? 'Merging…' : 'Merge (Fast)'}
                                    </button>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-700 dark:text-gray-300">Crossfade</label>
                                        <input
                                            type="number"
                                            min={0.1}
                                            max={2}
                                            step={0.1}
                                            value={crossfadeSeconds}
                                            onChange={(e) => setCrossfadeSeconds(Math.max(0.1, Math.min(2, parseFloat(e.target.value || '0.5'))))}
                                            className="w-20 bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-1"
                                            aria-label="Crossfade seconds"
                                        />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">sec</span>
                                        <button
                                            onClick={() => mergeSegmentsWithCrossfade(crossfadeSeconds)}
                                            disabled={isMerging}
                                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400"
                                            title="Re-encode with crossfade transitions (slower)"
                                        >
                                            {isMerging ? 'Merging…' : 'Merge with Crossfade'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        {mergedVideoUrl && (
                            <div className="mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-md font-semibold text-gray-900 dark:text-white">Merged Video</h3>
                                    <a href={mergedVideoUrl} download={`veo-merged-${Date.now()}.mp4`} className="text-sm text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-md" onClick={() => { try { trackEvent('video_download', { kind: 'merged' }); } catch {} }}>Download MP4</a>
                                </div>
                                <video controls src={mergedVideoUrl} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 shadow" onPlay={() => { try { trackEvent('video_play', { kind: 'merged' }); } catch {} }} />
                            </div>
                        )}
                        <div className="grid grid-cols-1 gap-3">
                            {segments.map((s, idx) => (
                                <div key={s.id} className="p-3 bg-gray-50/50 dark:bg-gray-900/50 rounded-md border border-gray-300 dark:border-gray-700">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {s.thumbDataUrl ? (
                                                <img src={s.thumbDataUrl} alt={`Segment ${idx + 1}`} className="w-14 h-10 object-cover rounded border border-gray-300 dark:border-gray-700" />
                                            ) : (
                                                <div className="w-14 h-10 rounded bg-gray-200 dark:bg-gray-700" />
                                            )}
                                            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">Segment {idx + 1} — {s.status || (s.videoUrl ? 'Ready' : 'Idle')}</p>
                                        </div>
                                        {s.videoUrl && (
                                            <a href={s.videoUrl} download={`veo-segment-${idx + 1}.mp4`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => { try { trackEvent('video_download', { kind: 'segment', index: idx + 1 }); } catch {} }}>Download</a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-gray-400 dark:text-gray-500">
                         <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        <p className="mt-2">Your generated video will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoGenerator;
