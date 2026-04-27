import React from 'react';
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { PredictionResult } from "../lib/gemini";
import { ChemicalStructure } from "./ChemicalStructure";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";

interface ResultsDisplayProps {
  result: PredictionResult;
  downloadExcel: () => void;
}

export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result, downloadExcel }) => {
  return (
    <div className="space-y-6">
        <div className="flex justify-end">
            <Button 
            variant="outline" 
            size="sm" 
            onClick={downloadExcel}
            className="bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200"
            >
            <Download className="mr-2 h-4 w-4" />
            Download Excel Report
            </Button>
        </div>

        <div className="space-y-6 bg-white p-1 rounded-xl">
            <Card className="border-slate-200 overflow-hidden">
                <CardHeader>
                    {/* ... compound rendering ... */}
                </CardHeader>
                <CardContent className="pt-6 space-y-8">
                    {/* ... degradation impurities ... */}
                    <Separator />
                    <div className="grid grid-cols-1 gap-8">
                      <section className="space-y-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2 text-[#0f172a]">
                          Mechanism of Interaction
                        </h4>
                        <div className="bg-[#f8fafc] p-4 rounded-xl border border-slate-100">
                          <p className="text-[#475569] text-sm leading-relaxed italic">
                            {result.mechanism}
                          </p>
                        </div>
                      </section>
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
  );
};
