import React, { useEffect, useRef } from 'react';
import SmilesDrawer from 'smiles-drawer';

interface ChemicalStructureProps {
  smiles: string;
  width?: number;
  height?: number;
  className?: string;
}

export const ChemicalStructure: React.FC<ChemicalStructureProps> = ({ 
  smiles, 
  width = 300, 
  height = 300,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState(false);

  useEffect(() => {
    if (!canvasRef.current || !smiles) {
      setError(true);
      return;
    }

    // Sanitize SMILES: remove all whitespace characters
    let sanitizedSmiles = smiles.trim().replace(/\s/g, '');

    // Basic Parenthesis Balancer: Ensure opening and closing parentheses match
    // This handles cases where the AI might truncate or miss a closing bracket
    const openCount = (sanitizedSmiles.match(/\(/g) || []).length;
    const closeCount = (sanitizedSmiles.match(/\)/g) || []).length;
    
    if (openCount > closeCount) {
      sanitizedSmiles += ')'.repeat(openCount - closeCount);
    } else if (closeCount > openCount) {
      // If there are more closing than opening, it's harder to fix correctly,
      // but we can try to remove the extra trailing ones
      let diff = closeCount - openCount;
      while (diff > 0 && sanitizedSmiles.endsWith(')')) {
        sanitizedSmiles = sanitizedSmiles.slice(0, -1);
        diff--;
      }
    }

    const options = {
      width: width,
      height: height,
      bondThickness: 1.2,
      bondLength: 15,
      fontSizeLarge: 10,
      fontSizeSmall: 8,
      padding: 5,
      compactDrawing: true,
      terminalCarbons: false,
      showStereo: true,
      themes: {
        monochrome: {
          C: '#000000',
          O: '#000000',
          N: '#000000',
          F: '#000000',
          Cl: '#000000',
          Br: '#000000',
          I: '#000000',
          P: '#000000',
          S: '#000000',
          B: '#000000',
          BACKGROUND: '#ffffff'
        }
      }
    };

    try {
      const smilesDrawer = new SmilesDrawer.Drawer(options);
      SmilesDrawer.parse(sanitizedSmiles, (tree: any) => {
        smilesDrawer.draw(tree, canvasRef.current!, 'monochrome', false);
        setError(false);
      }, (err: any) => {
        console.error('SmilesDrawer parse error:', err);
        setError(true);
      });
    } catch (err) {
      console.error('SmilesDrawer initialization error:', err);
      setError(true);
    }
  }, [smiles, width, height]);

  if (error || !smiles) {
    return (
      <div 
        style={{ width, height }} 
        className={`flex items-center justify-center bg-slate-50 rounded-lg border border-dashed border-slate-200 ${className}`}
      >
        <span className="text-[10px] text-slate-400 italic">Structure N/A</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center bg-white rounded-lg ${className}`}>
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height}
        className="max-w-full h-auto mix-blend-multiply"
      />
    </div>
  );
};
