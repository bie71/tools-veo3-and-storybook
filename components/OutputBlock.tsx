import React, { useState } from 'react';
import { CopyIcon } from './icons';
import { trackEvent } from '../analytics';

interface OutputBlockProps {
  title: string;
  content: string;
  language?: string;
}

const OutputBlock: React.FC<OutputBlockProps> = ({ title, content, language = 'text' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    try { trackEvent('output_copy', { title }); } catch {}
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg flex flex-col h-full backdrop-blur-sm">
      <div className="flex justify-between items-center p-4 border-b border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        <button
          onClick={handleCopy}
          className="flex items-center px-3 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-800 focus:ring-indigo-500 transition-colors duration-200"
        >
          {copied ? 'Copied!' : <><CopyIcon /> <span className="ml-2">Copy</span></>}
        </button>
      </div>
      <pre className="p-4 text-gray-600 dark:text-gray-300 text-sm overflow-auto h-full whitespace-pre-wrap flex-grow bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
        <code className={`language-${language}`}>
          {content}
        </code>
      </pre>
    </div>
  );
};

export default OutputBlock;
