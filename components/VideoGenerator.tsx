import React, { useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import InputGroup from './InputGroup';
import { TrashIcon, LoaderIcon } from './icons';
import { CHARACTER_STYLES } from '../constants';

interface VideoGeneratorProps {
    apiKey: string;
}

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
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
    const [enableAudio, setEnableAudio] = useState(true);
    const [aiMode, setAiMode] = useState(AI_MODES[0]);
    const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0]); // Default to the latest model
    const [useCustomModel, setUseCustomModel] = useState(false);
    const [customModelId, setCustomModelId] = useState('');
    const [characterStyle, setCharacterStyle] = useState(CHARACTER_STYLES[0]);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    
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

    const handleGenerateVideo = async () => {
        if (!apiKey) {
            setError('Please enter and save your Gemini API Key in the header.');
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

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'An unknown error occurred during video generation.');
        } finally {
            setIsLoading(false);
        }
    };

    const renderSelect = (label: string, value: string, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, options: readonly string[]) => (
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
            <select 
                value={value} 
                onChange={onChange}
                className="appearance-none w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                aria-label={label}
            >
                {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        </div>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* INPUTS COLUMN */}
            <div className="flex flex-col space-y-6">
                <InputGroup title="Video Prompt & Settings">
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
                    <textarea 
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="e.g., A neon hologram of a cat driving at top speed"
                        className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y min-h-64"
                        rows={12}
                        aria-label="Video Prompt"
                    />
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
                
                <button
                    onClick={handleGenerateVideo}
                    disabled={isLoading}
                    className="w-full flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                >
                    {isLoading ? <><LoaderIcon /> <span className="ml-2">Generating...</span></> : 'Generate Video'}
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
                    <div className="w-full p-4 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg" role="alert">
                        <p className="font-bold text-center">Error</p>
                        <p className="text-center mt-2">{error}</p>
                    </div>
                ) : generatedVideoUrl ? (
                     <div className="w-full">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 text-center">Generated Video</h3>
                        <video controls src={generatedVideoUrl} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 shadow-lg" onEnded={() => { if(generatedVideoUrl) URL.revokeObjectURL(generatedVideoUrl)}}>
                            Your browser does not support the video tag.
                        </video>
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
