import React from 'react';

interface InputGroupProps {
  title: string;
  actionButton?: React.ReactNode;
  children: React.ReactNode;
}

const InputGroup: React.FC<InputGroupProps> = ({ title, actionButton, children }) => {
  return (
    <div className="bg-white/50 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-lg p-6 mb-6 shadow-lg backdrop-blur-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
        {actionButton}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
};

export default InputGroup;