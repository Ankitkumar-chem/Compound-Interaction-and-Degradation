import React, { useEffect, useState } from 'react';
import { getMoleculeSvg } from '../lib/rdkit';

interface ChemicalStructureProps {
  smiles: string;
  width?: number;
  height?: number;
  className?: string;
}

export const ChemicalStructure: React.FC<ChemicalStructureProps> = ({ 
  smiles, 
  width = 200, 
  height = 200,
  className = ""
}) => {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    
    if (!smiles) {
      setError(true);
      setSvgContent(null);
      return;
    }

    setError(false);
    
    getMoleculeSvg(smiles, width, height).then((svg) => {
      if (!mounted) return;
      if (svg) {
        setSvgContent(svg);
        setError(false);
      } else {
        setError(true);
        setSvgContent(null);
      }
    });

    return () => { mounted = false; };
  }, [smiles, width, height]);

  return (
    <div 
      className={`relative flex items-center justify-center bg-white rounded-lg ${className}`}
      style={{ width, height }}
    >
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-[10px] text-slate-400 p-2 text-center"> Structure unavailable </div>
      )}
      {!error && svgContent && (
        <div 
          className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svgContent }} 
        />
      )}
    </div>
  );
};
