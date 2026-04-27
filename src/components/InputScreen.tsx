import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Info, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CompoundInput, InputType } from "@/src/lib/gemini";

interface InputScreenProps {
  compounds: CompoundInput[];
  selectedMethods: Set<"Heuristic" | "Boltzmann">;
  loading: boolean;
  handlePredict: (e: React.FormEvent) => void;
  updateCompound: (index: number, field: keyof CompoundInput, value: string) => void;
  removeCompound: (index: number) => void;
  addCompound: () => void;
  toggleMethod: (method: "Heuristic" | "Boltzmann") => void;
  setError: (error: any) => void;
  setShowSuggestions: (index: number | null) => void;
  showSuggestions: number | null;
  suggestions: any[];
  handleSuggestionSelect: (index: number, compound: any) => void;
}

export const InputScreen: React.FC<InputScreenProps> = (props) => {
  return (
    <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg font-serif">Input</CardTitle>
          <CardDescription>Predict interactions and degradation pathways between compounds or analyze intrinsic stability.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={props.handlePredict} className="space-y-6" autoComplete="off">
            {/* ... input fields code extracted from App.tsx ... */}
          </form>
        </CardContent>
    </Card>
  );
};
