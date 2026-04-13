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
  width = 200, 
  height = 200,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const options = {
        width: width,
        height: height,
        bondThickness: 1.2,
        bondLength: 15,
        shortBondLength: 0.85,
        bondSpacing: 0.18 * 15,
        atomVisualization: 'default',
        isomeric: true,
        debug: false,
        terminalCarbons: false,
        explicitHydrogens: false,
        overlapSensitivity: 0.42,
        overlapResolutionIterations: 10,
        compactDrawing: true,
        fontSizeLarge: 11,
        fontSizeSmall: 7,
        padding: 10
      };

      const smilesDrawer = new SmilesDrawer.Drawer(options);
      
      SmilesDrawer.parse(smiles, (tree: any) => {
        smilesDrawer.draw(tree, canvasRef.current, 'light', false);
      }, (err: any) => {
        console.error('SmilesDrawer error:', err);
      });
    }
  }, [smiles, width, height]);

  return (
    <div className={`flex items-center justify-center bg-white rounded-lg ${className}`}>
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height}
        className="max-w-full h-auto"
      />
    </div>
  );
};
