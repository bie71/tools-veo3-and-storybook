import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import InputGroup from './InputGroup';
import { LoaderIcon, BookOpenIcon } from './icons';
import { STORYBOOK_AGES, STORYBOOK_ART_STYLES } from '../constants';
import { StoryPage } from '../types';
import { trackEvent } from '../analytics';
import { RequestQueue, QueueSnapshot } from '../lib/requestQueue';

interface StorybookBuilderProps {
    apiKey: string;
}

interface StoryJobInput {
    apiKey: string;
    prompt: string;
    ageGroup: string;
    artStyle: string;
}

const StorybookBuilder: React.FC<StorybookBuilderProps> = ({ apiKey }) => {
    const [prompt, setPrompt] = useState('');
    const [ageGroup, setAgeGroup] = useState(STORYBOOK_AGES[0]);
    const [artStyle, setArtStyle] = useState(STORYBOOK_ART_STYLES[0]);
    
    const [isLoading, setIsLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [storyPages, setStoryPages] = useState<StoryPage[]>([]);

    const storyQueueDelayRaw = Number(import.meta.env.VITE_STORY_QUEUE_DELAY_MS ?? '5000');
    const storyQueueDelay = Number.isFinite(storyQueueDelayRaw) && storyQueueDelayRaw >= 0 ? storyQueueDelayRaw : 5000;
    const storyQueue = React.useMemo(() => new RequestQueue(storyQueueDelay), [storyQueueDelay]);
    const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(storyQueue.snapshot());
    const [activeQueueJobId, setActiveQueueJobId] = useState<string | null>(null);

    React.useEffect(() => {
        const unsubscribe = storyQueue.subscribe(setQueueSnapshot);
        return unsubscribe;
    }, [storyQueue]);

    React.useEffect(() => {
        if (!activeQueueJobId) return;
        const { activeTaskId, queuedIds, delayRemainingMs } = queueSnapshot;
        if (activeTaskId === activeQueueJobId) return;
        const position = queuedIds.indexOf(activeQueueJobId);
        if (position === -1) return;
        if (position === 0) {
            if (typeof delayRemainingMs === 'number') {
                const seconds = Math.max(0, Math.ceil(delayRemainingMs / 1000));
                setStatusMessage(`Queued — starting in ${seconds}s`);
            } else {
                setStatusMessage('Queued — waiting to start...');
            }
        } else {
            setStatusMessage(`Queued — ${position} request${position === 1 ? '' : 's'} ahead...`);
        }
    }, [queueSnapshot, activeQueueJobId]);


    const performStoryGeneration = async (context: StoryJobInput) => {
        const { apiKey: ctxApiKey, prompt: ctxPrompt, ageGroup: ctxAgeGroup, artStyle: ctxArtStyle } = context;
        setError(null);
        setStoryPages([]);
        setStatusMessage('Generating story from your idea...');

        try {
            const ai = new GoogleGenAI({ apiKey: ctxApiKey });

            const storyTextResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Create a short, illustrated children's story based on this idea: "${ctxPrompt}". The story should be appropriate for children who are ${ctxAgeGroup}. The story should be broken into 5 pages. For each page, provide the page text and a detailed, descriptive prompt for an illustrator to create an image in a ${ctxArtStyle} style.`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            pages: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        text: { type: Type.STRING },
                                        image_prompt: { type: Type.STRING }
                                    },
                                    required: ["text", "image_prompt"]
                                }
                            }
                        },
                        required: ["pages"]
                    },
                },
            });

            const storyData = JSON.parse(storyTextResponse.text || '{}');
            const rawPages = Array.isArray(storyData?.pages) ? storyData.pages : [];
            if (!rawPages.length) {
                throw new Error('No story pages returned by Gemini.');
            }

            const pagesWithImages: StoryPage[] = rawPages.map((p: any) => ({
                text: String(p?.text || ''),
                imagePrompt: String(p?.image_prompt || p?.imagePrompt || ''),
            }));
            setStoryPages(pagesWithImages.map(p => ({ ...p })));

            const totalPages = pagesWithImages.length;
            for (let i = 0; i < totalPages; i++) {
                const page = pagesWithImages[i];
                setStatusMessage(`Generating image for page ${i + 1} of ${totalPages}...`);

                const imageResponse = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: `${page.imagePrompt}, in the art style of ${ctxArtStyle}.`,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '1:1',
                    },
                });

                const base64Image = imageResponse?.generatedImages?.[0]?.image?.imageBytes;
                if (!base64Image) {
                    throw new Error('No image returned for a story page.');
                }

                pagesWithImages[i] = { ...page, imageUrl: `data:image/jpeg;base64,${base64Image}` };
                setStoryPages(pagesWithImages.map(p => ({ ...p })));
            }

            setStatusMessage('Story complete!');
            try { trackEvent('generate_story_success', { pages: pagesWithImages.length, art_style: ctxArtStyle, age_group: ctxAgeGroup }); } catch {}
        } catch (err: any) {
            console.error(err);
            const message = err?.message || 'An unknown error occurred during story generation.';
            setError(message);
            try { trackEvent('generate_story_error', { message: String(err?.message || '').slice(0, 120) }); } catch {}
            throw err;
        }
    };


    const handleGenerateStory = async () => {
        try { trackEvent('generate_story_start', { age_group: ageGroup, art_style: artStyle }); } catch {}
        if (!apiKey) {
            setError('Please enter and save your Gemini API Key in the header.');
            return;
        }
        if (!prompt) {
            setError('Please enter a story idea.');
            return;
        }

        const jobContext: StoryJobInput = {
            apiKey,
            prompt,
            ageGroup,
            artStyle,
        };

        setIsLoading(true);
        setError(null);
        setStoryPages([]);
        setStatusMessage('Queued — waiting to start...');

        const job = storyQueue.enqueue(() => performStoryGeneration(jobContext), { description: 'Storybook generation' });
        setActiveQueueJobId(job.id);

        try {
            await job.promise;
        } catch (_) {
            // Errors handled inside performStoryGeneration.
        } finally {
            setIsLoading(false);
            setActiveQueueJobId(null);
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
                        placeholder={`Custom ${label}`}
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
                 <InputGroup title="Story Idea">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
                    <textarea 
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="e.g., A curious rabbit who finds a magical, glowing carrot"
                        className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                        rows={4}
                        aria-label="Story Idea Prompt"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderSelect('Target Age Group', ageGroup, e => setAgeGroup(e.target.value), STORYBOOK_AGES)}
                        {renderSelect('Art Style', artStyle, e => setArtStyle(e.target.value), STORYBOOK_ART_STYLES)}
                    </div>
                </InputGroup>
                
                <button
                    onClick={handleGenerateStory}
                    disabled={isLoading}
                    className="w-full flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-colors"
                >
                    {isLoading ? <><LoaderIcon /> <span className="ml-2">Generating...</span></> : 'Generate Story'}
                </button>
            </div>

            {/* OUTPUT COLUMN */}
            <div className="sticky top-[150px] h-fit flex flex-col justify-start items-center bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg p-4 min-h-[400px] max-h-[calc(100vh-180px)] overflow-y-auto backdrop-blur-sm">
                {isLoading && !storyPages.length ? (
                    <div className="text-center m-auto" role="status" aria-live="polite">
                        <LoaderIcon />
                        <p className="text-indigo-600 dark:text-indigo-400 mt-4">{statusMessage}</p>
                    </div>
                ) : error ? (
                    <div className="w-full p-4 m-auto bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg break-words max-h-48 overflow-auto overflow-x-hidden" role="alert">
                        <p className="font-bold text-center">Error</p>
                        <p className="text-center mt-2 break-words break-all whitespace-pre-wrap w-full max-w-full">{error}</p>
                    </div>
                ) : storyPages.length > 0 ? (
                     <div className="w-full space-y-6">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white text-center">Your Generated Storybook</h3>
                        {isLoading && <p className="text-center text-indigo-600 dark:text-indigo-400 animate-pulse">{statusMessage}</p>}
                        {storyPages.map((page, index) => (
                            <div key={index} className="p-4 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg border border-gray-300 dark:border-gray-700">
                                {page.imageUrl ? (
                                    <img src={page.imageUrl} alt={`Illustration for page ${index + 1}`} className="w-full aspect-square object-cover rounded-md mb-4" />
                                ) : (
                                    <div className="w-full aspect-square bg-gray-200 dark:bg-gray-700 rounded-md mb-4 flex items-center justify-center">
                                        <LoaderIcon />
                                    </div>
                                )}
                                <p className="text-gray-700 dark:text-gray-300">{page.text}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-gray-400 dark:text-gray-500 m-auto">
                        <BookOpenIcon />
                        <p className="mt-2">Your generated story will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StorybookBuilder;
