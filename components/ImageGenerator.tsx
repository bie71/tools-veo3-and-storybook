import React, { useMemo, useState } from 'react';
import InputGroup from './InputGroup';
import { LoaderIcon, TrashIcon } from './icons';
import { GoogleGenAI, PersonGeneration, RawReferenceImage, Modality } from '@google/genai';
import { trackEvent } from '../analytics';
import { RequestQueue, QueueSnapshot } from '../lib/requestQueue';

interface ImageGeneratorProps {
  apiKey: string;
}

const DEFAULT_IMAGE_MODELS = [
  // Recommend stable, widely-available IDs first (may vary per account/region/API version)
  'imagen-4.0-generate-001',
  // Additional commonly referenced IDs
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
  'imagen-3.0-generate-002',
];

const TECHNIQUES = ['Text to Image', 'Image to Image', 'Photo Edit (Gemini 2.5)'];
const IMAGE_SIZES = [
  { value: '1920x1080', label: 'Full HD (1920x1080)' },
  { value: '1280x720', label: 'HD (1280x720)' },
  { value: '2048x2048', label: '2048x2048' },
  { value: '1024x1024', label: '1024x1024' },
  { value: '1024x768', label: '1024x768' },
  { value: '768x1024', label: '768x1024' },
] as const;
const STYLE_PRESETS = ['Default', 'Photorealistic', 'Illustration', 'Anime', 'Cinematic', '3D', 'Pixel', 'Banana'] as const;
const GEMINI_TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

type StylePreset = typeof STYLE_PRESETS[number] | '__custom__';

interface ImageJobInput {
  apiKey: string;
  prompt: string;
  technique: string;
  modelId: string;
  stylePreset: StylePreset;
  customStyle: string;
  size: string;
  count: number;
  aspectRatio: string;
  outputMimeType: 'image/png' | 'image/jpeg';
  includeRaiReason: boolean;
  personGen: 'Unspecified' | 'Allow Adult';
  useEnhancedPrompt: boolean;
  boostedPrompt: string;
  refImages: File[];
}

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = reject;
});

const ImageGenerator: React.FC<ImageGeneratorProps> = ({ apiKey }) => {
  const [prompt, setPrompt] = useState('');
  const [technique, setTechnique] = useState<string>(TECHNIQUES[0]);
  // Default to Imagen 3 by request
  const [imageModel, setImageModel] = useState<string>('imagen-3.0-generate-002');
  const [availableModels, setAvailableModels] = useState<string[]>(DEFAULT_IMAGE_MODELS);
  const [isListingModels, setIsListingModels] = useState(false);
  const [listMessage, setListMessage] = useState('');
  const [autoDetected, setAutoDetected] = useState<boolean>(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModelId, setCustomModelId] = useState('');
  const [stylePreset, setStylePreset] = useState<StylePreset>(STYLE_PRESETS[0]);
  const [customStyle, setCustomStyle] = useState<string>('');
  const [size, setSize] = useState<string>('1024x1024');
  const [count, setCount] = useState<number>(1);
  const [textModel, setTextModel] = useState<string>(GEMINI_TEXT_MODELS[0]);
  const [boostedPrompt, setBoostedPrompt] = useState<string>('');
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [useEnhancedForGeneration, setUseEnhancedForGeneration] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [outputMimeType, setOutputMimeType] = useState<'image/png' | 'image/jpeg'>('image/jpeg');
  const [includeRaiReason, setIncludeRaiReason] = useState<boolean>(false);
  const [personGen, setPersonGen] = useState<'Unspecified' | 'Allow Adult'>('Unspecified');

  const [refImages, setRefImages] = useState<File[]>([]);
  const [refPreviews, setRefPreviews] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const imageQueueDelayRaw = Number(import.meta.env.VITE_IMAGE_QUEUE_DELAY_MS ?? '5000');
  const imageQueueDelay = Number.isFinite(imageQueueDelayRaw) && imageQueueDelayRaw >= 0 ? imageQueueDelayRaw : 5000;
  const imageQueue = React.useMemo(() => new RequestQueue(imageQueueDelay), [imageQueueDelay]);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(imageQueue.snapshot());
  const [activeQueueJobId, setActiveQueueJobId] = useState<string | null>(null);

  React.useEffect(() => {
    const unsubscribe = imageQueue.subscribe(setQueueSnapshot);
    return unsubscribe;
  }, [imageQueue]);

  React.useEffect(() => {
    if (!activeQueueJobId) return;
    const { activeTaskId, queuedIds, delayRemainingMs } = queueSnapshot;
    if (activeTaskId === activeQueueJobId) return;
    const position = queuedIds.indexOf(activeQueueJobId);
    if (position === -1) return;
    if (position === 0) {
      if (typeof delayRemainingMs === 'number') {
        const seconds = Math.max(0, Math.ceil(delayRemainingMs / 1000));
        setStatus(`Queued — starting in ${seconds}s`);
      } else {
        setStatus('Queued — waiting to start...');
      }
    } else {
      setStatus(`Queued — ${position} request${position === 1 ? '' : 's'} ahead...`);
    }
  }, [queueSnapshot, activeQueueJobId]);

  const modelId = useMemo(() => (useCustomModel && customModelId.trim() ? customModelId.trim() : imageModel), [useCustomModel, customModelId, imageModel]);

  // --- Analytics-aware handlers ---
  const handleTechniqueChange = (v: string) => {
    setTechnique(v);
    try { trackEvent('image_technique_change', { technique: v }); } catch {}
  };
  const handleStylePresetChange = (v: string) => {
    if (v === '__custom__') {
      setStylePreset('__custom__');
    } else {
      setStylePreset(v);
    }
    try { trackEvent('image_style_preset_change', { preset: v }); } catch {}
  };
  const handleSizeChange = (v: string) => {
    setSize(v);
    try { trackEvent('image_size_change', { size: v }); } catch {}
  };
  const handleCountChange = (n: number) => {
    setCount(n);
    try { trackEvent('image_count_change', { count: n }); } catch {}
  };
  const handleAspectRatioChange = (v: string) => {
    setAspectRatio(v);
    try { trackEvent('image_aspect_change', { aspect: v }); } catch {}
  };
  const handleMimeChange = (v: 'image/png' | 'image/jpeg') => {
    setOutputMimeType(v);
    try { trackEvent('image_mime_change', { mime: v }); } catch {}
  };
  const handleRaiToggle = (b: boolean) => {
    setIncludeRaiReason(b);
    try { trackEvent('image_rai_toggle', { include: b }); } catch {}
  };
  const handlePersonGenChange = (v: 'Unspecified' | 'Allow Adult') => {
    setPersonGen(v);
    try { trackEvent('image_person_gen_change', { value: v }); } catch {}
  };
  const handleModelPresetChange = (v: string) => {
    if (v === '__custom__') { setUseCustomModel(true); return; }
    setUseCustomModel(false);
    setImageModel(v);
    // Ultra supports only 1 image
    if (/imagen-4\.0-ultra-generate-001/i.test(v) && count !== 1) {
      setCount(1);
    }
    try { trackEvent('image_model_change', { model: v }); } catch {}
  };
  const handleCustomModelBlur = () => {
    try { trackEvent('image_model_custom_set', { has_value: !!customModelId.trim(), length: customModelId.trim().length }); } catch {}
  };
  const handleAssistantModelChange = (v: string) => {
    setTextModel(v);
    try { trackEvent('image_assistant_model_change', { model: v }); } catch {}
  };
  const handleCustomStyleBlur = () => {
    try { trackEvent('image_style_custom_set', { has_value: !!customStyle.trim(), length: customStyle.trim().length }); } catch {}
  };

  const handleEnhancePrompt = async () => {
    try { trackEvent('image_assistant_enhance_click', { model: textModel }); } catch {}
    if (!apiKey) { setError('Please enter and save your Gemini API Key in the header.'); return; }
    if (!prompt.trim()) { setError('Please enter a prompt before enhancing.'); return; }
    setIsEnhancing(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model: textModel,
        contents: `Rewrite this into a concise, vivid image-generation prompt. Avoid camera words unless necessary, include key visual attributes and composition, stay under 120 words.\n\n${prompt}`,
        config: { responseMimeType: 'text/plain' }
      });
      const txt = (res as any).text?.trim?.() || String(res) || '';
      if (!txt) throw new Error('No text returned by Gemini.');
      setBoostedPrompt(txt);
      try { trackEvent('image_assistant_enhance_success', { length: txt.length }); } catch {}
    } catch (err: any) {
      const msg = String(err?.message || err || 'Prompt assistant failed');
      setError(msg.includes('PERMISSION') || msg.toLowerCase().includes('permission')
        ? 'Your API key may not have access to Gemini 2.5 Pro. Switch to Flash or upgrade your key.'
        : `Prompt assistant error: ${msg}`);
      try { trackEvent('image_assistant_enhance_error', { message: String(err?.message || '').slice(0, 120) }); } catch {}
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleCopyEnhanced = async () => {
    try {
      await navigator.clipboard.writeText(boostedPrompt || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      try { trackEvent('image_assistant_copy'); } catch {}
    } catch {}
  };

  const handleRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) { e.target.value = ''; return; }
    const accepted: File[] = [];
    for (const f of files) {
      if (f.size > 6 * 1024 * 1024) { setError('Reference image must be <= 6MB'); continue; }
      accepted.push(f);
      try { trackEvent('image_reference_upload', { mime: f.type, size_kb: Math.round(f.size / 1024) }); } catch {}
    }
    if (accepted.length) {
      const urls = accepted.map(f => URL.createObjectURL(f));
      setRefImages(prev => [...prev, ...accepted]);
      setRefPreviews(prev => [...prev, ...urls]);
    }
    e.target.value = '';
  };

  const performImageGeneration = async (context: ImageJobInput) => {
    const {
      apiKey: ctxApiKey,
      prompt: ctxPrompt,
      technique: ctxTechnique,
      modelId: ctxModelId,
      stylePreset: ctxStylePreset,
      customStyle: ctxCustomStyle,
      size: ctxSize,
      count: ctxCount,
      aspectRatio: ctxAspectRatio,
      outputMimeType: ctxOutputMimeType,
      includeRaiReason: ctxIncludeRaiReason,
      personGen: ctxPersonGen,
      useEnhancedPrompt: ctxUseEnhancedPrompt,
      boostedPrompt: ctxBoostedPrompt,
      refImages: ctxRefImages,
    } = context;

    setImages([]);
    setError(null);
    setStatus('Preparing request...');

    try {
      const ai = new GoogleGenAI({ apiKey: ctxApiKey });

      let finalPrompt = ctxPrompt;
      if (ctxUseEnhancedPrompt) {
        if (!ctxBoostedPrompt.trim()) {
          throw new Error('Enhanced prompt is empty. Click "Enhance Prompt" first or disable "Use enhanced".');
        }
        finalPrompt = ctxBoostedPrompt;
      }

      let imagePayloads: { imageBytes: string; mimeType: string }[] = [];
      if ((ctxTechnique === 'Image to Image' || ctxTechnique === 'Photo Edit (Gemini 2.5)') && ctxRefImages.length) {
        setStatus('Processing reference image(s)...');
        imagePayloads = [];
        for (const file of ctxRefImages) {
          const base64 = await fileToBase64(file);
          imagePayloads.push({ imageBytes: base64, mimeType: file.type });
        }
      }

      const additions: string[] = [];
      if (ctxStylePreset === '__custom__') {
        if (ctxCustomStyle.trim()) additions.push(`${ctxCustomStyle.trim()} style`);
      } else if (ctxStylePreset && ctxStylePreset !== 'Default') {
        additions.push(`${ctxStylePreset} style`);
      }
      if (ctxSize) additions.push(`target size ${ctxSize}`);

      const fullPrompt = additions.length ? `${finalPrompt}. ${additions.join(', ')}.` : finalPrompt;

      setStatus('Requesting image generation...');
      let operation: any;
      try {
        if (ctxTechnique === 'Photo Edit (Gemini 2.5)') {
          if (!imagePayloads.length) { throw new Error('Please upload at least one reference image for Photo Edit.'); }
          const gc = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
              parts: [
                ...imagePayloads.map(p => ({ inlineData: { data: p.imageBytes, mimeType: p.mimeType } })),
                { text: fullPrompt }
              ]
            },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] }
          });
          const out: string[] = [];
          const dataStr = (gc as any).data as string | undefined;
          if (dataStr) {
            out.push(`data:${ctxOutputMimeType};base64,${dataStr}`);
          } else if (Array.isArray((gc as any).candidates) && (gc as any).candidates.length) {
            const parts = (gc as any).candidates[0]?.content?.parts || [];
            for (const p of parts) {
              if (p?.inlineData?.data) {
                const mt = p?.inlineData?.mimeType || ctxOutputMimeType || 'image/jpeg';
                out.push(`data:${mt};base64,${p.inlineData.data}`);
              }
            }
          }
          if (!out.length) throw new Error('No image returned by Gemini Photo Edit.');
          setImages(out);
          setStatus('Done');
          try { trackEvent('generate_image_success', { count: out.length, mode: 'gemini_edit' }); } catch {}
          return;
        } else if (ctxTechnique === 'Image to Image' && imagePayloads.length) {
          const refs: any[] = [];
          for (const payload of imagePayloads) {
            const ref = new RawReferenceImage();
            (ref as any).referenceImage = payload;
            refs.push(ref);
          }
          operation = await ai.models.editImage({
            model: ctxModelId,
            prompt: fullPrompt,
            referenceImages: refs,
            config: {
              numberOfImages: Math.max(1, Math.min(4, ctxCount)),
              aspectRatio: ctxAspectRatio,
              personGeneration: ctxPersonGen === 'Allow Adult' ? PersonGeneration.ALLOW_ADULT : undefined,
              outputMimeType: ctxOutputMimeType,
              includeRaiReason: ctxIncludeRaiReason,
            }
          });
        } else {
          operation = await ai.models.generateImages({
            model: ctxModelId,
            prompt: fullPrompt,
            config: {
              numberOfImages: Math.max(1, Math.min(4, ctxCount)),
              aspectRatio: ctxAspectRatio,
              personGeneration: ctxPersonGen === 'Allow Adult' ? PersonGeneration.ALLOW_ADULT : undefined,
              outputMimeType: ctxOutputMimeType,
              includeRaiReason: ctxIncludeRaiReason,
            }
          });
        }
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        const canFallbackFast = /not[_\s-]?found|404/i.test(msg) && /-fast-generate-001$/i.test(ctxModelId);
        if (canFallbackFast) {
          const fallbackModel = ctxModelId.replace(/-fast-generate-001$/i, '-generate-001');
          try {
            setStatus(`Model not found. Retrying with ${fallbackModel}...`);
            try { trackEvent('generate_image_fallback', { from: ctxModelId, to: fallbackModel }); } catch {}
            if (ctxTechnique === 'Image to Image' && imagePayloads.length) {
              const refs2: any[] = [];
              for (const payload of imagePayloads) {
                const ref = new RawReferenceImage();
                (ref as any).referenceImage = payload;
                refs2.push(ref);
              }
              operation = await ai.models.editImage({
                model: fallbackModel,
                prompt: fullPrompt,
                referenceImages: refs2,
                config: {
                  numberOfImages: Math.max(1, Math.min(4, ctxCount)),
                  aspectRatio: ctxAspectRatio,
                  personGeneration: ctxPersonGen === 'Allow Adult' ? PersonGeneration.ALLOW_ADULT : undefined,
                  outputMimeType: ctxOutputMimeType,
                  includeRaiReason: ctxIncludeRaiReason,
                }
              });
            } else {
              operation = await ai.models.generateImages({
                model: fallbackModel,
                prompt: fullPrompt,
                config: {
                  numberOfImages: Math.max(1, Math.min(4, ctxCount)),
                  aspectRatio: ctxAspectRatio,
                  personGeneration: ctxPersonGen === 'Allow Adult' ? PersonGeneration.ALLOW_ADULT : undefined,
                  outputMimeType: ctxOutputMimeType,
                  includeRaiReason: ctxIncludeRaiReason,
                }
              });
            }
          } catch (_) {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if ((operation as any).error) {
        throw new Error(String((operation as any).error?.message || 'Image generation error'));
      }

      const imgs = (operation as any).response?.generatedImages || (operation as any).generatedImages;
      if (!imgs || !imgs.length) {
        throw new Error('No images returned by the model.');
      }

      setStatus('Preparing images...');
      const urls: string[] = [];
      for (const item of imgs) {
        const img = item?.image || {};
        const bytes = img?.imageBytes as string | undefined;
        const uri: string | undefined = img?.uri || (item as any)?.uri;
        if (bytes) {
          const mime = img?.mimeType || ctxOutputMimeType || 'image/png';
          urls.push(`data:${mime};base64,${bytes}`);
          continue;
        }
        if (!uri) continue;
        const response = await fetch(`${uri}&key=${ctxApiKey}`);
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.statusText}`);
        }
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        urls.push(dataUrl);
      }

      setImages(urls);
      setStatus('Done');
      try { trackEvent('generate_image_success', { count: urls.length, mode: ctxTechnique.toLowerCase().replace(/\s+/g, '_') }); } catch {}
    } catch (err: any) {
      const msg = String(err?.message || err || 'An unknown error occurred during image generation.');
      setError(msg);
      try { trackEvent('generate_image_error', { message: msg.slice(0, 120) }); } catch {}
      throw err;
    }
  };

  const detectAvailableModels = async (): Promise<string[] | null> => {
    if (!apiKey) { setError('Please enter and save your Gemini API Key in the header.'); return; }
    setIsListingModels(true);
    setListMessage('Detecting available models...');
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp: any = await ai.models.list({});
      const items: any[] = resp?.models || resp?.items || (Array.isArray(resp) ? resp : []);
      const found: string[] = [];
      for (const m of items) {
        const raw = m?.name || m?.model || m?.id || '';
        if (!raw) continue;
        const id = String(raw).replace(/^models\//, '');
        const idLower = id.toLowerCase();
        if (!idLower.includes('imagen')) continue;
        // If API provides supported methods, prefer those with image gen
        const methods = (m?.supportedGenerationMethods || m?.generationMethods || m?.supportedMethods || []) as string[];
        if (!methods.length || methods.join(',').toLowerCase().includes('image')) {
          found.push(id);
        }
      }
      const unique = Array.from(new Set(found));
      if (unique.length) {
        setAvailableModels(unique);
        setListMessage(`Found ${unique.length} Imagen models.`);
        try { trackEvent('image_models_detected', { count: unique.length }); } catch {}
        // If current preset is not in list and not custom, try switch to first
        if (!useCustomModel && !unique.includes(imageModel)) {
          setImageModel(unique[0]);
        }
        try {
          localStorage.setItem('imagen_available_models', JSON.stringify(unique));
          localStorage.setItem('imagen_auto_detect_done', '1');
        } catch {}
        return unique;
      } else {
        setListMessage('');
        try { trackEvent('image_models_none'); } catch {}
        return [];
      }
    } catch (err: any) {
      setListMessage('Failed to list models');
      setError(err?.message || 'Failed to list models');
      try { trackEvent('image_models_list_error', { message: String(err?.message || '').slice(0, 120) }); } catch {}
      return null;
    } finally {
      setIsListingModels(false);
    }
  };

  // Load cached detection result and auto-detect once per session when key is present
  React.useEffect(() => {
    try {
      const cachedList = localStorage.getItem('imagen_available_models');
      if (cachedList) {
        const arr = JSON.parse(cachedList);
        if (Array.isArray(arr) && arr.length) setAvailableModels(arr);
      }
      const done = localStorage.getItem('imagen_auto_detect_done') === '1';
      if (done) setAutoDetected(true);
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!apiKey) return;
    if (autoDetected) return;
    (async () => {
      try {
        try { trackEvent('image_models_autodetect_start'); } catch {}
        await detectAvailableModels();
      } finally {
        setAutoDetected(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, autoDetected]);

  const removeRefAt = (idx: number) => {
    setRefPreviews(prev => {
      const url = prev[idx];
      if (url) URL.revokeObjectURL(url);
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    setRefImages(prev => {
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
  };
  const clearRefs = () => {
    for (const url of refPreviews) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    setRefImages([]);
    setRefPreviews([]);
    try { trackEvent('image_reference_clear_all'); } catch {}
  };




  const handleGenerateImages = async () => {
    try {
      trackEvent('generate_image_start', {
        model: useCustomModel ? 'custom' : imageModel,
        technique,
        count,
        size,
        style: stylePreset,
      });
    } catch {}

    if (!apiKey) { setError('Please enter and save your Gemini API Key in the header.'); return; }
    if (!prompt.trim()) { setError('Please enter a prompt.'); return; }
    if (useCustomModel && !customModelId.trim()) { setError('Enter a custom model ID or disable custom.'); return; }

    if (!useCustomModel && Array.isArray(availableModels) && availableModels.length && !availableModels.includes(imageModel)) {
      const msg = `Selected model "${imageModel}" is not in your detected models. Click "Detect Models" and choose a listed model.`;
      setError(msg);
      try { trackEvent('image_model_not_in_detected', { model: imageModel }); } catch {}
      return;
    }

    if (useEnhancedForGeneration && !boostedPrompt.trim()) {
      setError('Enhanced prompt is empty. Click "Enhance Prompt" first or disable "Use enhanced".');
      return;
    }

    const jobContext: ImageJobInput = {
      apiKey,
      prompt,
      technique,
      modelId,
      stylePreset: stylePreset as StylePreset,
      customStyle,
      size,
      count,
      aspectRatio,
      outputMimeType,
      includeRaiReason,
      personGen,
      useEnhancedPrompt: useEnhancedForGeneration,
      boostedPrompt,
      refImages: Array.from(refImages),
    };

    setIsLoading(true);
    setError(null);
    setImages([]);
    setStatus('Queued — waiting to start...');

    const job = imageQueue.enqueue(() => performImageGeneration(jobContext), { description: 'Image generation' });
    setActiveQueueJobId(job.id);

    try {
      await job.promise;
    } catch (_) {
      // Errors handled within performImageGeneration.
    } finally {
      setIsLoading(false);
      setActiveQueueJobId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <InputGroup title="Prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            className="w-full h-28 bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </InputGroup>

        <InputGroup title="Prompt Assistant (Gemini 2.5)">
          <div className="flex items-center gap-3 mb-3">
            <button
              type="button"
              onClick={handleEnhancePrompt}
              disabled={isEnhancing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 text-sm"
            >
              {isEnhancing ? (<><LoaderIcon/> Enhancing…</>) : 'Enhance Prompt'}
            </button>
            <select
              value={textModel}
              onChange={(e) => handleAssistantModelChange(e.target.value)}
              className="bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
            >
              {GEMINI_TEXT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm mb-2">
            <input
              type="checkbox"
              checked={useEnhancedForGeneration}
              onChange={(e) => { setUseEnhancedForGeneration(e.target.checked); try { trackEvent('image_assistant_use_toggle', { enabled: e.target.checked }); } catch {} }}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Use enhanced prompt when generating
          </label>
          {boostedPrompt && (
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Enhanced Prompt</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setPrompt(boostedPrompt); try { trackEvent('image_assistant_use_enhanced'); } catch {} }} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">Use Enhanced</button>
                  <button type="button" onClick={handleCopyEnhanced} className="text-xs px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <textarea readOnly value={boostedPrompt} className="w-full h-48 bg-gray-200/30 dark:bg-gray-800/30 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2" />
            </div>
          )}
        </InputGroup>

        <InputGroup title="Settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Technique</label>
              <select
                value={technique}
                onChange={(e) => handleTechniqueChange(e.target.value)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                {TECHNIQUES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Style Preset</label>
              <select
                value={STYLE_PRESETS.includes(stylePreset as any) ? stylePreset : '__custom__'}
                onChange={(e) => handleStylePresetChange(e.target.value)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                {STYLE_PRESETS.map(s => <option key={s} value={s}>{s}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {stylePreset === '__custom__' && (
                <input
                  type="text"
                  value={customStyle}
                  onChange={(e) => setCustomStyle(e.target.value)}
                  onBlur={handleCustomStyleBlur}
                  placeholder="Describe your custom style"
                  className="mt-2 w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Size</label>
              <select
                value={size}
                onChange={(e) => handleSizeChange(e.target.value)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                {IMAGE_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Images</label>
              <input
                type="number"
                min={1}
                max={4}
                value={count}
                onChange={(e) => handleCountChange(Math.max(1, Math.min(4, Number(e.target.value || '1'))))}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aspect Ratio</label>
              <select
                value={aspectRatio}
                onChange={(e) => handleAspectRatioChange(e.target.value)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                {['1:1','3:4','4:3','16:9','9:16'].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Output Format</label>
              <select
                value={outputMimeType}
                onChange={(e) => handleMimeChange(e.target.value as any)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                <option value="image/jpeg">JPEG (smaller)</option>
                <option value="image/png">PNG</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">RAI Details</label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeRaiReason} onChange={(e) => handleRaiToggle(e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                Include RAI reason
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">People Generation</label>
              <select
                value={personGen}
                onChange={(e) => handlePersonGenChange(e.target.value as any)}
                className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              >
                <option value="Unspecified">Default</option>
                <option value="Allow Adult">Allow adult</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Controls realism and face/person outputs. Respect policy and terms.</p>
            </div>
          </div>
        </InputGroup>

        <InputGroup title="Model">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Preset</label>
              <div>
                <select
                  value={useCustomModel ? '__custom__' : imageModel}
                  onChange={(e) => handleModelPresetChange(e.target.value)}
                  className="w-full bg-gray-200/50 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
                >
                  {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
              </div>
              {listMessage && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{listMessage}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Custom Model ID</label>
              <input
                type="text"
                value={customModelId}
                onChange={(e) => { setCustomModelId(e.target.value); setUseCustomModel(true); }}
                onBlur={handleCustomModelBlur}
                placeholder="e.g., imagen-3.0-generate-001"
                className="w-full bg-gray-200/50 dark:bg-gray-700/50 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-md p-2"
              />
            </div>
          </div>
        </InputGroup>

        <InputGroup title="Reference Image(s) (optional)">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">Use one or more images to guide Image to Image or Photo Edit.</p>
            <div className="flex items-center gap-3">
              <input type="file" accept="image/*" multiple onChange={handleRefChange} className="text-sm" />
              {refPreviews.length > 0 && (
                <button onClick={clearRefs} className="px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-2"><TrashIcon/>Clear All</button>
              )}
            </div>
            {refPreviews.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {refPreviews.map((src, idx) => (
                  <div key={src} className="relative">
                    <img src={src} alt={`reference-${idx+1}`} className="w-24 h-24 object-cover rounded border border-gray-300 dark:border-gray-700" />
                    <button onClick={() => removeRefAt(idx)} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center" title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </InputGroup>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerateImages}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400"
          >
            {isLoading ? (<><LoaderIcon/> Generating…</>) : 'Generate Images'}
          </button>
          {status && <span className="text-sm text-gray-600 dark:text-gray-400">{status}</span>}
        </div>
      </div>

      <div className="sticky top-[150px] h-fit flex flex-col justify-center items-center bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg p-4 min-h-[400px] backdrop-blur-sm">
        {isLoading ? (
          <div className="text-center" role="status" aria-live="polite">
            <LoaderIcon />
            <p className="text-indigo-600 dark:text-indigo-400 mt-4">{status}</p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-2">
              <div className="bg-indigo-600 h-2.5 rounded-full animate-pulse w-3/4 mx-auto"></div>
            </div>
          </div>
        ) : error ? (
          <div className="w-full p-4 bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg break-words max-h-48 overflow-auto overflow-x-hidden" role="alert">
            <p className="font-bold text-center">Error</p>
            <p className="text-center mt-2 break-words break-all whitespace-pre-wrap w-full max-w-full">{error}</p>
          </div>
        ) : images.length ? (
          <div className="w-full">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-md font-semibold text-gray-900 dark:text-white">Results</h3>
            </div>
            {/* First image wide */}
            <div className="p-2 bg-gray-50/50 dark:bg-gray-900/50 rounded-md border border-gray-300 dark:border-gray-700 mb-4">
              <img src={images[0]} alt={`Generated 1`} className="w-full h-auto rounded" />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Image 1</span>
                <a href={images[0]} download={`imagen-1.png`} className="text-sm text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-md" onClick={() => { try { trackEvent('image_download', { index: 1 }); } catch {} }}>Download</a>
              </div>
            </div>
            {/* Remaining images stacked below */}
            {images.length > 1 && (
              <div className="space-y-4">
                {images.slice(1).map((url, i) => {
                  const idx = i + 2;
                  return (
                    <div key={url} className="p-2 bg-gray-50/50 dark:bg-gray-900/50 rounded-md border border-gray-300 dark:border-gray-700">
                      <img src={url} alt={`Generated ${idx}`} className="w-full h-auto rounded" />
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Image {idx}</span>
                        <a href={url} download={`imagen-${idx}.png`} className="text-sm text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-md" onClick={() => { try { trackEvent('image_download', { index: idx }); } catch {} }}>Download</a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-gray-400 dark:text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            <p className="mt-2">Generated images will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageGenerator;
